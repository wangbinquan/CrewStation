// RFC-034: headless page support must never advertise interactive PTY metering.
import {test,expect} from 'bun:test';
import {developmentCapabilitiesSupported} from './developmentDispatch';
import type {DevelopmentStartIntent,RunnerHello} from '@crewstation/contracts';
test('CLI requires independent numeric bit while headless retains original support',()=>{
 const original={intent:{identity:{sourceKind:'development-cli'},nativeSource:{version:2}} as DevelopmentStartIntent,binding:null,digestNonce:'x'};
 const c:RunnerHello['capabilities']={protocols:['opencode'],pty:true,preview:false,developmentUsageV1:1,developmentUsageStopV1:1,usageObservationsV1:1,developmentNativeSourceV1:1,nativeUsageTreeV1:1,developmentNativePagesV2:2};
 expect(developmentCapabilitiesSupported(original,c)).toBe(false);expect(developmentCapabilitiesSupported(original,{...c,developmentNativeCliV2:2})).toBe(true);
 expect(developmentCapabilitiesSupported({...original,intent:{...original.intent,identity:{...original.intent.identity,sourceKind:'development-agent'}}},c)).toBe(true);
});
