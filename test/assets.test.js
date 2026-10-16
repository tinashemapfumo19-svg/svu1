import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetAuthority, assetDate, assertAssetAction, validateAssetCopies, validateAssetDefinition } from '../server/modules/assets.js';
import { staffInvitationRoles } from '../server/modules/staff.js';
const data={assetTag:'IT_001',barcode:'B001',serialNumber:'S001',name:'Computer',category:'IT',acquiredOn:'2026-01-01',acquisitionMethod:'Purchase',valueMinor:10001,currency:'USD',departmentId:'dept',location:'Store',condition:'serviceable',reason:'Received',replayKey:'asset_key_123456789'};
test('asset definitions use bounded whole minor units and explicit real past dates',() => {
  assert.equal(validateAssetDefinition(data,'2026-10-09').valueMinor,10001);
  for (const change of [{valueMinor:1.1},{valueMinor:-1},{valueMinor:10000000001},{currency:'usd'},{currency:['USD']},{assetTag:'bad space'},{condition:'usable'},{acquiredOn:'2026-02-30'},{acquiredOn:'2027-01-01'},{status:'disposed'},{reason:''}]) assert.throws(() => validateAssetDefinition({...data,...change},'2026-10-09'));
  for (const date of [null,undefined,'','2026-02-30']) assert.throws(() => assetDate(date));
  assert.throws(() => assetDate('2026-10-01','2026-10-02','2026-10-09'));
});
test('asset bulk copies require exact bounded unique identifiers and explicit receipt details',() => {
  const input={revision:1,copies:[{assetTag:'IT_002'},{assetTag:'IT_003'}],acquiredOn:'2026-10-09',departmentId:'dept',location:'Store',condition:'serviceable',reason:'Received copies'};
  assert.equal(validateAssetCopies(input,'2026-10-09').copies.length,2);
  for (const copies of [[],Array(51).fill({assetTag:'IT_002'}),[{assetTag:'IT_002'},{assetTag:'IT_002'}],[{assetTag:'IT_002',barcode:'B1'},{assetTag:'IT_003',barcode:'B1'}],[{assetTag:'IT_002',staffId:'other'}]]) assert.throws(() => validateAssetCopies({...input,copies},'2026-10-09'));
});
test('asset custody and terminal states cannot be skipped',() => {
  assert.doesNotThrow(() => assertAssetAction({status:'available',condition:'serviceable'},'allocate'));
  for (const condition of ['damaged','repair','missing']) assert.throws(() => assertAssetAction({status:'available',condition},'allocate'));
  assert.throws(() => assertAssetAction({status:'allocated',condition:'serviceable'},'allocate'));
  assert.throws(() => assertAssetAction({status:'available'},'return'));
  assert.throws(() => assertAssetAction({status:'disposal_pending'},'return'));
  for (const action of ['allocate','return','edit','check','dispose']) assert.throws(() => assertAssetAction({status:'disposed'},action));
  assert.doesNotThrow(() => assertAssetAction({status:'disposed'},'copy'));
});
test('asset authority is supplied only by the permission-bearing global role',() => {
  assert.equal(assetAuthority({roles:[{code:'asset_officer',permissions:['assets.manage'],scope:{programmeCodes:['BSC']}},{code:'hr_officer',permissions:['staff.manage'],scope:{}}]},'assets.manage'),false);
  assert.equal(assetAuthority({roles:[{code:'asset_officer',permissions:['assets.manage'],scope:{}}]},'assets.manage'),true);
  assert.equal(assetAuthority({roles:[{code:'asset_approver',permissions:['assets.approve'],scope:{}}]},'assets.manage'),false);
});
test('asset roles can be appointed through the existing staff acceptance workflow',() => {
  assert.ok(staffInvitationRoles.includes('asset_officer'));
  assert.ok(staffInvitationRoles.includes('asset_approver'));
  assert.ok(!staffInvitationRoles.includes('system_administrator'));
});
