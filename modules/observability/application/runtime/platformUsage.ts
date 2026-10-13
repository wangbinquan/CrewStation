import type {Actor,RuntimeStatisticsQuery} from '@crewstation/contracts';
import {forbidden} from '@crewstation/kernel';
import type {PlatformUsageStore} from '../../ports/platformUsage';
export function platformUsageQueries(store:PlatformUsageStore){return async(actor:Actor,window:RuntimeStatisticsQuery,after?:string)=>{if(!actor.isAdmin)throw forbidden('仅系统管理员可读取平台算力用量');return store.read(window,after);};}
