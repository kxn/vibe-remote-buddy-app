import {describe,it,expect} from 'vitest';
import {validateSettings} from '../src/core/settings';
describe('configuration import',()=>{
 it('accepts an empty versioned configuration',()=>expect(validateSettings({schema:1,background:true,boards:{}}).schema).toBe(1));
 it('rejects unknown versions and invalid action targets',()=>{
  expect(()=>validateSettings({schema:9,background:true,boards:{}})).toThrow();
  expect(()=>validateSettings({schema:1,background:true,boards:{test:{aliases:{},authorizations:{},followers:{},shared:{},actions:{1:{kind:'web',target:'javascript:alert(1)',label:'bad'}}}}})).toThrow();
 });
 it('rejects changing a voice key into an ordinary key in imported templates',()=>{
  expect(()=>validateSettings({schema:1,background:true,boards:{test:{aliases:{},authorizations:{},followers:{},actions:{},shared:{2:{key:2,kind:1,modifiers:0,value:40}}}}})).toThrow();
 });
});
