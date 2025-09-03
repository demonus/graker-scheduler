const axios = require('axios');
const { parseString } = require('xml2js');

class EduPointService {
  constructor() {
    this.baseURL = 'https://ca-pleas-psv.edupoint.com';
    this.session = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Accept': '*/*',
        'Content-Type': 'text/xml; charset=utf-8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'ParentVUE/12.2.15 CFNetwork/1410.1 Darwin/22.6.0'
      }
    });
  }

  /**
   * Smart XML decoding that only decodes XML structure tags,
   * preserving HTML entities within attribute values.
   */
  smartXmlDecode(xmlContent) {
    // First, protect attribute values by temporarily replacing them
    const attrValuePattern = /="([^"]*)"/g;
    const protectedContent = xmlContent;
    const attrValues = [];
    
    const protectAttrValue = (match) => {
      attrValues.push(match[1]);
      return `="__ATTR_VALUE_${attrValues.length - 1}__"`;
    };
    
    // Replace all attribute values with placeholders
    const protectedXml = protectedContent.replace(attrValuePattern, protectAttrValue);
    
    // Now decode the XML structure (tags, etc.)
    const decodedContent = protectedXml
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    
    // Restore the original attribute values (with their HTML entities intact)
    let finalContent = decodedContent;
    for (let i = 0; i < attrValues.length; i++) {
      finalContent = finalContent.replace(`__ATTR_VALUE_${i}__`, attrValues[i]);
    }
    
    return finalContent;
  }

  /**
   * Make a SOAP request to EduPoint API
   */
  async makeSoapRequest(methodName, username, password, paramStr, skipLoginLog = '0') {
    let soapAction, soapBody;
    
    if (methodName === 'ChildList') {
      soapAction = 'http://edupoint.com/webservices/ProcessWebServiceRequestMultiWeb';
      soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <ProcessWebServiceRequestMultiWeb xmlns="http://edupoint.com/webservices/">
            <userID>${username}</userID>
            <password>${password}</password>
            <skipLoginLog>${skipLoginLog}</skipLoginLog>
            <parent>1</parent>
            <webDBName></webDBName>
            <webServiceHandleName>PXPWebServices</webServiceHandleName>
            <methodName>${methodName}</methodName>
            <paramStr>${paramStr}</paramStr>
        </ProcessWebServiceRequestMultiWeb>
    </soap:Body>
</soap:Envelope>`;
    } else {
      soapAction = 'http://edupoint.com/webservices/ProcessWebServiceRequest';
      soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <ProcessWebServiceRequest xmlns="http://edupoint.com/webservices/">
            <userID>${username}</userID>
            <password>${password}</password>
            <skipLoginLog>${skipLoginLog}</skipLoginLog>
            <parent>1</parent>
            <webServiceHandleName>PXPWebServices</webServiceHandleName>
            <methodName>${methodName}</methodName>
            <paramStr>${paramStr}</paramStr>
        </ProcessWebServiceRequest>
    </soap:Body>
</soap:Envelope>`;
    }
    
    try {
      const response = await this.session.post('/Service/PXPCommunication.asmx', soapBody, {
        headers: {
          'SOAPAction': soapAction
        }
      });
      
      return response.data;
    } catch (error) {
      throw new Error(`SOAP request failed: ${error.message}`);
    }
  }

  /**
   * Get gradebook for a specific child
   */
  async getGradebook(username, password, childIntId) {
    const paramStr = `<Parms><ChildIntID>${childIntId}</ChildIntID></Parms>`;
    const responseXml = await this.makeSoapRequest('Gradebook', username, password, paramStr, '1');
    
    return this.parseGradebookResponse(responseXml);
  }

  /**
   * Parse gradebook response
   */
  parseGradebookResponse(xmlResponse) {
    return new Promise((resolve, reject) => {
      parseString(xmlResponse, (err, result) => {
        if (err) {
          reject(new Error(`Failed to parse gradebook response: ${err.message}`));
          return;
        }
        
        try {
          const resultElem = result['soap:Envelope']['soap:Body'][0]['ProcessWebServiceRequestResponse'][0]['ProcessWebServiceRequestResult'][0];
          const decodedXml = this.smartXmlDecode(resultElem);
          
          parseString(decodedXml, (err2, innerResult) => {
            if (err2) {
              reject(new Error(`Failed to parse inner XML: ${err2.message}`));
              return;
            }
            
            const courses = [];
            const courseElements = innerResult.Gradebook?.[0]?.Courses?.[0]?.Course || [];
            
            for (const courseElem of courseElements) {
              const markElem = courseElem.Marks?.[0]?.Mark?.[0];
              const courseData = {
                title: courseElem.$.Title || '',
                teacher: courseElem.$.Staff || '',
                room: courseElem.$.Room || '',
                period: courseElem.$.Period || '',
                calculatedScore: markElem?.$.CalculatedScoreString || ''
              };
              courses.push(courseData);
            }
            
            resolve(courses);
          });
        } catch (error) {
          reject(new Error(`Failed to extract gradebook: ${error.message}`));
        }
      });
    });
  }
}

module.exports = new EduPointService();
