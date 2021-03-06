//      
const BlockPassHttpProvider = require("./BlockPassHttpProvider");
const jwt = require("jsonwebtoken");
const jsonld = require('jsonld');
const jsig = require('jsonld-signatures');
const merkleTreeHelper = require("./utils/MerkleHelper");

jsig.use('jsonld', jsonld);

/**
 * @class Class ServerSdk
 */
class ServerSdk {
                                  
                              
                              
                                        
                                                   
                                                 
                         
                           
                           
                  
                   
                                               
                                                 

  /**
   *
   * @param {ConstructorParams} params
   */
  constructor({
    baseUrl,
    clientId,
    secretId,
    requiredFields,
    optionalFields,
    certs,
    findKycById,
    createKyc,
    updateKyc,
    queryKycStatus,
    needRecheckExistingKyc,
    generateSsoPayload,
    encodeSessionData,
    decodeSessionData
  }) {
    if (clientId == null || secretId == null)
      throw new Error("Missing clientId or secretId");

    if (
      findKycById == null ||
      (findKycById != null && typeof findKycById !== "function")
    )
      throw new Error("findKycById should be null or function");

    if (
      createKyc == null ||
      (createKyc != null && typeof createKyc !== "function")
    )
      throw new Error("createKyc should be null or function");

    if (
      updateKyc == null ||
      (updateKyc != null && typeof updateKyc !== "function")
    )
      throw new Error("updateKyc should be null or function");

    if (
      queryKycStatus == null ||
      (queryKycStatus != null && typeof queryKycStatus !== "function")
    )
      throw new Error("queryKycStatus should be null or function");

    this.findKycById = findKycById;
    this.createKyc = createKyc;
    this.updateKyc = updateKyc;
    this.queryKycStatus = queryKycStatus;

    this.needRecheckExistingKyc = needRecheckExistingKyc;
    this.generateSsoPayload = generateSsoPayload;
    this.encodeSessionData = encodeSessionData;
    this.decodeSessionData = decodeSessionData;

    this.blockPassProvider = new BlockPassHttpProvider({
      baseUrl,
      clientId,
      secretId
    });
    this.clientId = clientId;
    this.secretId = secretId;
    this.requiredFields = requiredFields;
    this.optionalFields = optionalFields;
    this.certs = certs;
  }

  /**
   * -----------------------------------------------------------------------------------
   * Login Flow, handling SSO and AppLink login from Blockpass client.
   *
   *  - Step 1: Handshake between Service and BlockPass
   *  - Step 2: Sync KycProfile with Blockpass
   *  - Step 3: Create / Update kycRecord via handler
   *
   * @param {Object} params
   */
  async loginFow({
    code,
    sessionCode
  }   
                 
                       
   )                                          {
    if (code == null || sessionCode == null)
      throw new Error("Missing code or sessionCode");

    const kycToken = await this.blockPassProvider.doHandShake(
      code,
      sessionCode
    );
    if (kycToken == null) throw new Error("Handshake failed");

    this._activityLog("[BlockPass]", kycToken);

    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
    if (kycProfile == null) throw new Error("Sync info failed");

    this._activityLog("[BlockPass]", kycProfile);

    let kycRecord = await Promise.resolve(this.findKycById(kycProfile.id));
    const isNewUser = kycRecord == null;
    if (isNewUser)
      kycRecord = await Promise.resolve(this.createKyc({ kycProfile }));

    let payload = {};
    if (isNewUser) {
      payload.nextAction = "upload";
      payload.requiredFields = this.requiredFields;
      payload.optionalFields = this.optionalFields;
      payload.certs = this.certs;
    } else {
      payload.message = "welcome back";
      payload.nextAction = "none";
    }

    if (kycRecord && this.needRecheckExistingKyc) {
      payload = await Promise.resolve(
        this.needRecheckExistingKyc({
          kycProfile,
          kycRecord,
          kycToken,
          payload
        })
      );
    }

    // Nothing need to update. Notify sso complete
    if (payload.nextAction === "none") {
      const ssoData = await Promise.resolve(
        this.generateSsoPayload
          ? this.generateSsoPayload({
              kycProfile,
              kycRecord,
              kycToken,
              payload
            })
          : {}
      );
      const res = await this.blockPassProvider.notifyLoginComplete(
        kycToken,
        sessionCode,
        ssoData
      );
      this._activityLog("[BlockPass] login success", res);
    }

    return {
      accessToken: this._encodeDataIntoToken({
        kycId: kycProfile.id,
        kycToken,
        sessionCode
      }),
      ...payload
    };
  }

  /**
   * -----------------------------------------------------------------------------------
   * Handle user data upload and fill-up kycRecord
   *  - Step 1: restore session from accessToken
   *  - Step 2: validate required fields provided by client vs serviceMetaData(required / optional)
   *  - Step 3: update raw data to kycRecord
   * @param {RawDataUploadDataRequest} params
   */
  async updateDataFlow({
    accessToken,
    slugList,
    ...userRawData
  }   
                        
                       
                       
   )                                          {
    if (!slugList) throw new Error("Missing slugList");

    const decodeData = this._decodeDataFromToken(accessToken);
    if (!decodeData) throw new Error("Invalid Access Token");
    const { kycId, kycToken, sessionCode } = decodeData;

    let kycRecord = await Promise.resolve(this.findKycById(kycId));
    if (!kycRecord) throw new Error("Kyc record could not found");

    // query kyc profile
    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
    if (kycProfile == null) throw new Error("Sync info failed");

    // matching existing record
    kycRecord = await Promise.resolve(
      this.updateKyc({
        kycRecord,
        kycProfile,
        kycToken,
        userRawData
      })
    );

    const payload = {
      nextAction: "none",
      message: "welcome back"
    };

    // Notify sso complete
    if (sessionCode) {
      const ssoData = await Promise.resolve(
        this.generateSsoPayload
          ? this.generateSsoPayload({
              kycProfile,
              kycRecord,
              kycToken,
              payload
            })
          : {}
      );
      const res = await this.blockPassProvider.notifyLoginComplete(
        kycToken,
        sessionCode,
        ssoData
      );
      this._activityLog("[BlockPass] login success", res);
    }

    return {
      ...payload
    };
  }

  /**
   * -----------------------------------------------------------------------------------
   * Register flow, receiving user sign-up infomation and creating KycProcess.
   * This behaves the same as loginFlow except for it does not require sessionCode input
   * @param {Object} params
   */
  async registerFlow({
    code
  }   
                
   )                                          {
    if (code == null) throw new Error("Missing code or sessionCode");

    const kycToken = await this.blockPassProvider.doHandShake(code);
    if (kycToken == null) throw new Error("Handshake failed");

    this._activityLog("[BlockPass]", kycToken);

    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
    if (kycProfile == null) throw new Error("Sync info failed");

    this._activityLog("[BlockPass]", kycProfile);

    let kycRecord = await Promise.resolve(this.findKycById(kycProfile.id));
    const isNewUser = kycRecord == null;
    if (isNewUser)
      kycRecord = await Promise.resolve(this.createKyc({ kycProfile }));

    let payload = {};
    if (isNewUser) {
      payload.nextAction = "upload";
      payload.requiredFields = this.requiredFields;
      payload.optionalFields = this.optionalFields;
      payload.certs = this.certs;
    } else {
      payload.message = "welcome back";
      payload.nextAction = "none";
    }

    if (kycRecord && this.needRecheckExistingKyc) {
      payload = await Promise.resolve(
        this.needRecheckExistingKyc({
          kycProfile,
          kycRecord,
          kycToken,
          payload
        })
      );
    }

    return {
      accessToken: this._encodeDataIntoToken({
        kycId: kycProfile.id,
        kycToken
      }),
      ...payload
    };
  }

  /**
   * -----------------------------------------------------------------------------------
   * Query status of kyc record
   * @param {Object} params
   */
  async queryStatusFlow({
    code,
    sessionCode
  }   
                 
                        
   )                                    {
    if (code == null) throw new Error("Missing code or sessionCode");

    let handShakePayload = [code]

    if (sessionCode)
      handShakePayload.push(sessionCode)

    const kycToken = await this.blockPassProvider.doHandShake(...handShakePayload);
    if (kycToken == null) throw new Error("Handshake failed");

    this._activityLog("[BlockPass]", kycToken);

    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
    if (kycProfile == null) throw new Error("Sync info failed");

    this._activityLog("[BlockPass]", kycProfile);

    let kycRecord = await Promise.resolve(this.findKycById(kycProfile.id));

    if (!kycRecord)
      return {
        status: "notFound",
        ...this._serviceRequirement()
      }

    const kycStatus = await Promise.resolve(this.queryKycStatus({ kycRecord }));

    // checking fields
    const { status, identities } = kycStatus;

    if (!status)
      throw new Error("[queryKycStatus] return missing fields: status");
    if (!identities)
      throw new Error("[queryKycStatus] return missing fields: identities");

    // Notify sso complete
    let payload = {};
    if (sessionCode) {
      const ssoData = await Promise.resolve(
        this.generateSsoPayload
          ? this.generateSsoPayload({
            kycProfile,
            kycRecord,
            kycToken,
            payload
          })
          : {}
      );
      const res = await this.blockPassProvider.notifyLoginComplete(
        kycToken,
        sessionCode,
        ssoData
      );
      this._activityLog("[BlockPass] login success", res);
    }

    return {
      ...kycStatus
    };
  }

  //-----------------------------------------------------------------------------------
  /**
   * Sign new Certificate and send to Blockpass
   * 
   */
  async signCertificate({
    id,
    entityInfo,
    organizationInfo,
    claimInfo,
    EcdsaPrivateKey,
    EcdaPublicKey,

    bpToken,
  }
  ) {

    if (!(id && claimInfo && entityInfo && organizationInfo && EcdsaPrivateKey && EcdaPublicKey))
      throw new Error("Missing required fields id, personInfo, organizationInfo, EcdsaPrivateKey, EcdaPublicKey ")

    const serviceMetaData = await this.blockPassProvider.queryServiceMetadata()

    if (!serviceMetaData)
      throw new Error("[Blockpass-Api] Service metadata not found")

    const cerSchema = await this.blockPassProvider.queryCertificateSchema(id);
    if (!cerSchema)
      throw new Error("[Blockpass-Api] Schema not found: " + id)

    const documents = {
      "@context": [{
        "@version": 1.1,
      },
        cerSchema.url,
        "https://w3id.org/security/v2",
      ],
      "Entity": {
        ...entityInfo
      },
      "Organization": {
        ...organizationInfo
      },
      "Claim": {
        ...claimInfo
      }
    }

    console.log(documents)

    try {
      const sign = await jsig.promises.sign(documents, {
        algorithm: 'EcdsaKoblitzSignature2016',
        creator: merkleTreeHelper.hash(EcdaPublicKey),
        privateKeyWif: EcdsaPrivateKey,
      })

      //Send to Blockpass
      const signResponse = await this.blockPassProvider.acceptCertificate(bpToken, sign)
      this._activityLog("[Blockpass-Api]",signResponse)


      return signResponse;
    }
    catch (ex) {
      console.error(ex)
      throw new Error('Signed document error: ' + ex.message)
    }
  }

  //-----------------------------------------------------------------------------------
  /**
   * Reject a given Certificate
   */
  async userNotify({
    message,
    title,

    bpToken
  }) {
    
    const res = await this.blockPassProvider.notifyUser(
      bpToken,
      message,
      title
    );
    return res;
  }

  //-----------------------------------------------------------------------------------
  /**
   * Query Merkle proof for a given slugList
   */
  async queryProofOfPath({
    kycToken,
    slugList
  }


  ) {
    const res = await this.blockPassProvider.queryProofOfPath(
      kycToken,
      slugList
    );
    return res;
  }

  //-----------------------------------------------------------------------------------
  _activityLog(...args) {
    console.log(...args);
  }

  _encodeDataIntoToken(payload     )         {
    const { encodeSessionData } = this;
    if (encodeSessionData) return encodeSessionData(payload);

    return jwt.sign(payload, this.secretId);
  }

  _decodeDataFromToken(accessToken        )          {
    try {
      const { decodeSessionData } = this;
      if (decodeSessionData) return decodeSessionData(accessToken);

      return jwt.verify(accessToken, this.secretId);
    } catch (error) {
      return null;
    }
  }

  _serviceRequirement()       {
    const { requiredFields, certs, optionalFields } = this

    const identities = requiredFields.map(itm => {
      return {
        slug: itm,
        status: ""
      }
    })

    const certificates = []

    return {
      identities,
      certificates
    }

  }

  //-----------------------------------------------------------------------------------
  /**
   * -----------------------------------------------------------------------------------
   * Check Merkle proof for invidual field
   */
  merkleProofCheckSingle(
    rootHash        ,
    rawData                 ,
    proofList     
  ) {
    return merkleTreeHelper.validateField(rootHash, rawData, proofList);
  }
}

module.exports = ServerSdk;

/**
 * --------------------------------------------------------
 * @type {Object}
 */
                          
                  
                   
                   
                           
                           
                  
                                  
                              
                              
                                        
                                                   
                                                 
                                                
                                               
  

/**
 * --------------------------------------------------------
 * KYC Records
 * @type {object}
 */
                     

/**
 * --------------------------------------------------------
 * RawData upload from Mobile App
 * @type {Object.<string, RawDataString | RawDataFile>}
 * @example
 * {
 *  // string fields
 *  "phone": { type: 'string', value:'09xxx'},
 *
 *  // buffer fields
 *  "selfie": { type: 'file', buffer: Buffer(..), originalname: 'fileOriginalName'}
 *
 *  // certificate fields with `[cer]` prefix
 *  "[cer]onfido": {type: 'string', value:'...'}
 *
 *  ....
 * }
 */
                                 
                                            
  

/**
 *
 * String fields from Mobile App
 * @type {Object}
 */
                      
                 
               
  

/**
 *
 * Binary fields from Mobile App
 * @type {Object}
 */
                    
               
                 
                       
  

/**
 * --------------------------------------------------------
 * KYC Record Status
 * @type {object}
 */
                                 
                       
                   
                     
                                   
                                    
  

/**
 * --------------------------------------------------------
 * Currently KycRecord status: "notFound" | "waiting" | "inreview" | "approved"
 * @type {string}
 */
                                                                     

/**
 * --------------------------------------------------------
 * KYC Record 's Field Status
 * @type {object}
 */
                          
               
                              
                 
  

/**
 * --------------------------------------------------------
 * Status for invidual fields: "received" | "approved" | "rejected" | "missing";
 * @type {string}
 */
                                                                            

/**
 * --------------------------------------------------------
 * Blockpass Kyc Profile object
 * @type {object}
 */
                   
             
                          
                   
                        
  

/**
 * --------------------------------------------------------
 * Kyc Profile 's syncing status: "syncing" | "complete"
 * @type {string}
 */
                                         

/**
 * --------------------------------------------------------
 * Blockpass KycToken object
 * @type {object}
 */
                 
                       
                     
                       
  

/**
 * --------------------------------------------------------
 * Client Next action: "none" | "upload"
 * @type {string}
 */
                                        

/**
 * --------------------------------------------------------
 * Blockpass Mobile Response
 * @type {object}
 */
                                       
                             
                   
                       
                            
                           
  

/**
 * --------------------------------------------------------
 * Handler function to query Kyc record by Id
 * @callback
 * @param {string} kycId
 * @return {Promise<KycRecord>}
 */
                                                                

/**
 * --------------------------------------------------------
 * Handler function to create new KycRecord
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @returns {Promise<KycRecord>}
 */
                                                                           

/**
 * --------------------------------------------------------
 * Handler function to update existing KycRecord
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.userRawData
 * @returns {Promise<KycRecord>}
 */
                          
                         
                       
                     
                     
                         

/**
 * --------------------------------------------------------
 * Handler function to summary status of KycRecord
 * @callback
 * @param {Object} params
 * @param {KycRecord} params.kycRecord
 * @returns {Promise<MobileAppKycRecordStatus>}
 */
                               
                      
                                        

/**
 * --------------------------------------------------------
 * Handler function return whether a KYC existing check is required
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.payload
 * @returns {Promise<Object>}
 */
                                 
                         
                       
                     
                 
                      

/**
 * --------------------------------------------------------
 * Handler function to generate SSo payload
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.payload
 * @returns {Promise<BlockpassMobileResponsePayload>;}
 */
                                   
                         
                       
                     
                 
                                              
