const cron = require('node-cron');
const { supabaseAdmin } = require('./config/supabase');
const edupointService = require('./services/edupoint');
const encryptionService = require('./utils/encryption');
require('dotenv').config();

class GradeScheduler {
  constructor() {
    this.schedulerKey = process.env.SCHEDULER_KEY;
    if (!this.schedulerKey) {
      throw new Error('SCHEDULER_KEY environment variable is required');
    }
  }

  /**
   * Start the scheduler
   */
  start() {
    console.log('🚀 Starting Graker Grade Scheduler...');
    
    // Run every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      console.log(`⏰ Running grade sync at ${new Date().toISOString()}`);
      await this.syncGrades();
    });

    console.log('✅ Scheduler started - running every 15 minutes');
  }

  /**
   * Sync grades for all accounts that are due
   */
  async syncGrades() {
    try {
      // Get current time to determine which accounts are due
      const now = new Date();
      const currentMinutes = now.getMinutes();
      
      // Determine which schedule is due (0, 15, 30, or 45)
      let dueSchedule;
      if (currentMinutes >= 0 && currentMinutes < 15) {
        dueSchedule = 0;
      } else if (currentMinutes >= 15 && currentMinutes < 30) {
        dueSchedule = 15;
      } else if (currentMinutes >= 30 && currentMinutes < 45) {
        dueSchedule = 30;
      } else {
        dueSchedule = 45;
      }

      console.log(`📊 Syncing grades for schedule: ${dueSchedule} minutes`);

      // Get accounts that are due for sync
      const { data: accounts, error } = await supabaseAdmin
        .from('user_school_accounts')
        .select(`
          id,
          dek_wrapped_scheduler,
          students (
            id,
            child_int_id,
            dek_wrapped_scheduler
          )
        `)
        .eq('is_verified', true)
        .eq('cron_schedule_minutes', dueSchedule);

      if (error) {
        console.error('❌ Error fetching accounts:', error);
        return;
      }

      if (accounts.length === 0) {
        console.log('ℹ️ No accounts due for sync at this time');
        return;
      }

      console.log(`📋 Found ${accounts.length} accounts to sync`);

      // Process each account
      for (const account of accounts) {
        await this.syncAccountGrades(account);
      }

      console.log('✅ Grade sync completed');
    } catch (error) {
      console.error('❌ Error in grade sync:', error);
    }
  }

  /**
   * Sync grades for a specific account
   */
  async syncAccountGrades(account) {
    try {
      console.log(`🔄 Syncing account: ${account.id}`);

      // Decrypt account credentials
      const dekData = JSON.parse(account.dek_wrapped_scheduler);
      const credentials = JSON.parse(encryptionService.decryptWithSchedulerKey(
        dekData.encryptedData,
        dekData.iv,
        dekData.tag,
        dekData.wrappedDEK,
        dekData.wrappedIV,
        dekData.wrappedTag,
        this.schedulerKey
      ));

      // Process each student
      for (const student of account.students) {
        await this.syncStudentGrades(student, credentials);
      }

      // Update last sync time
      await supabaseAdmin
        .from('user_school_accounts')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', account.id);

      console.log(`✅ Account ${account.id} synced successfully`);
    } catch (error) {
      console.error(`❌ Error syncing account ${account.id}:`, error);
    }
  }

  /**
   * Sync grades for a specific student
   */
  async syncStudentGrades(student, credentials) {
    try {
      // Decrypt student data
      const studentDekData = JSON.parse(student.dek_wrapped_scheduler);
      const studentData = JSON.parse(encryptionService.decryptWithSchedulerKey(
        studentDekData.encryptedData,
        studentDekData.iv,
        studentDekData.tag,
        studentDekData.wrappedDEK,
        studentDekData.wrappedIV,
        studentDekData.wrappedTag,
        this.schedulerKey
      ));

      const childIntId = studentData.intId;

      // Get current grades from EduPoint
      const courses = await edupointService.getGradebook(
        credentials.username,
        credentials.password,
        childIntId
      );

      // Update current grades
      for (const course of courses) {
        await this.updateStudentGrade(student.id, course);
      }

      console.log(`📊 Updated ${courses.length} grades for student ${student.id}`);
    } catch (error) {
      console.error(`❌ Error syncing student ${student.id}:`, error);
    }
  }

  /**
   * Update a student's grade for a specific course
   */
  async updateStudentGrade(studentId, course) {
    try {
      // Check if grade already exists
      const { data: existingGrade, error: checkError } = await supabaseAdmin
        .from('current_grades')
        .select('id, calculated_score')
        .eq('student_id', studentId)
        .eq('course_title', course.title)
        .single();

      const now = new Date().toISOString();

      if (checkError && checkError.code !== 'PGRST116') {
        throw new Error(checkError.message);
      }

      if (existingGrade) {
        // Update existing grade
        const { error: updateError } = await supabaseAdmin
          .from('current_grades')
          .update({
            teacher_name: course.teacher,
            room: course.room,
            period: course.period,
            calculated_score: course.calculatedScore,
            last_updated: now
          })
          .eq('id', existingGrade.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        // Add to history if grade changed
        if (existingGrade.calculated_score !== course.calculatedScore) {
          await supabaseAdmin
            .from('grade_history')
            .insert({
              student_id: studentId,
              course_title: course.title,
              teacher_name: course.teacher,
              room: course.room,
              period: course.period,
              calculated_score: course.calculatedScore,
              recorded_at: now
            });
        }
      } else {
        // Insert new grade
        const { error: insertError } = await supabaseAdmin
          .from('current_grades')
          .insert({
            student_id: studentId,
            course_title: course.title,
            teacher_name: course.teacher,
            room: course.room,
            period: course.period,
            calculated_score: course.calculatedScore,
            last_updated: now
          });

        if (insertError) {
          throw new Error(insertError.message);
        }

        // Add to history
        await supabaseAdmin
          .from('grade_history')
          .insert({
            student_id: studentId,
            course_title: course.title,
            teacher_name: course.teacher,
            room: course.room,
            period: course.period,
            calculated_score: course.calculatedScore,
            recorded_at: now
          });
      }
    } catch (error) {
      console.error(`❌ Error updating grade for student ${studentId}, course ${course.title}:`, error);
    }
  }
}

// Start the scheduler
const scheduler = new GradeScheduler();
scheduler.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down scheduler...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down scheduler...');
  process.exit(0);
});

module.exports = GradeScheduler;
