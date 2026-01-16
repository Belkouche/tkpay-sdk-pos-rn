#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(TkpayNaps, NSObject)

RCT_EXTERN_METHOD(sendPaymentRequest:(NSString *)host
                  port:(NSInteger)port
                  tlvData:(NSString *)tlvData
                  timeout:(NSInteger)timeout
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sendConfirmation:(NSString *)tlvData
                  timeout:(NSInteger)timeout
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(testConnection:(NSString *)host
                  port:(NSInteger)port
                  timeout:(NSInteger)timeout
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

@end
