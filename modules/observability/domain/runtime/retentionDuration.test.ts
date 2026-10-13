import {test,expect} from 'bun:test';
import {retentionDuration} from './retentionDuration';
test('reads original source retention without a guessed seven/thirty day policy',()=>{expect(retentionDuration('8d')).toBe(8*86400000);expect(retentionDuration('1w2d3h')).toBe(9*86400000+10800000);for(const input of [undefined,'','0d','7d garbage','12','-1d'])expect(retentionDuration(input)).toBeUndefined();});
