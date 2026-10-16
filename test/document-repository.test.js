import test from "node:test";
import assert from "node:assert/strict";
import { canSeeCollection, normaliseKeywords, searchPattern, validateCatalogue, validateCollection } from "../server/modules/document-repository.js";

const roles = ["system_administrator","academic_registrar","records_manager","student","hr_officer"];

test("collections need a code, name, known classification and roles, and bounded retention",() => {
  assert.deepEqual(validateCollection({code:"hr_policies",name:" HR policies ",classification:"confidential",viewRoles:["hr_officer","hr_officer"],studentAccess:false,allowDownload:false,retentionYears:7},roles),
    {code:"hr_policies",name:"HR policies",classification:"confidential",viewRoles:["hr_officer"],studentAccess:false,allowDownload:false,retentionYears:7});
  for (const bad of [{code:"HR"},{name:"ab"},{classification:"secret"},{viewRoles:["nobody"]},{studentAccess:"yes"},{retentionYears:0},{retentionYears:2.5}]) {
    assert.throws(() => validateCollection({code:"hr_policies",name:"HR policies",classification:"internal",...bad},roles),{statusCode:400});
  }
  assert.deepEqual(validateCollection({retentionYears:null},roles,{partial:true}),{retentionYears:null});
});

test("keywords are trimmed, lower-cased, de-duplicated, and bounded",() => {
  assert.deepEqual(normaliseKeywords([" Policy ","policy","Leave"]),["leave","policy"]);
  assert.deepEqual(normaliseKeywords(undefined),[]);
  assert.throws(() => normaliseKeywords(Array.from({length:21},(_,i) => `k${i}`)),{statusCode:400});
  assert.throws(() => normaliseKeywords(["x".repeat(41)]),{statusCode:400});
});

test("collections are visible to managers, their view roles, and students only when opened to them",() => {
  const collection = {status:"active",viewRoles:["hr_officer"],studentAccess:false};
  const actor = (codes,permissions = []) => ({permissions,roles:codes.map((code) => ({code}))});
  assert.equal(canSeeCollection(collection,actor(["hr_officer"])),true);
  assert.equal(canSeeCollection(collection,actor(["academic_registrar"])),false);
  assert.equal(canSeeCollection(collection,actor(["student"])),false);
  assert.equal(canSeeCollection({...collection,studentAccess:true},actor(["student"])),true);
  assert.equal(canSeeCollection({...collection,status:"archived"},actor(["hr_officer"])),false);
  assert.equal(canSeeCollection({...collection,status:"archived"},actor(["records_manager"],["repository.manage"])),true);
});

test("search patterns escape LIKE wildcards so user text matches literally",() => {
  assert.equal(searchPattern("50%_off\\"),"%50\\%\\_off\\\\%");
});

test("optional collection fields keep their defaults when omitted",() => {
  assert.deepEqual(validateCollection({code:"minutes",name:"Senate minutes",classification:"internal"},roles),{code:"minutes",name:"Senate minutes",classification:"internal"});
  assert.throws(() => validateCollection({code:"minutes",name:"Senate minutes"},roles),{statusCode:400});
});

test("library catalogue fields are optional, bounded, and normalised; null clears",() => {
  assert.deepEqual(validateCatalogue({author:"  Achebe, C. ",publicationYear:1958,resourceType:"book",programmeCodes:["bsc-cs","BSC-CS","ba-lit"]}),
    {author:"Achebe, C.",publicationYear:1958,resourceType:"book",programmeCodes:["BA-LIT","BSC-CS"]});
  assert.deepEqual(validateCatalogue({}),{});
  assert.deepEqual(validateCatalogue({author:null,resourceType:null}),{author:null,resourceType:null});
  for (const bad of [{author:" "},{publicationYear:999},{publicationYear:2001.5},{resourceType:"poster"},{programmeCodes:["bad code"]},{programmeCodes:"BSC"}]) assert.throws(() => validateCatalogue(bad),{statusCode:400});
});
