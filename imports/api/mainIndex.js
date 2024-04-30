import { Mongo } from 'meteor/mongo';

import { Config } from '/imports/startup/both/config';

import { Files, deleteAssociatedFiles } from '/imports/api/files';
import { SandstormInfo } from '/imports/api/sandstorm';
import { Sources } from '/imports/api/sources';
import { fetchAllParts, readFileAsString } from '/imports/lib/fetch';
import { ensureDirectoryStructure, storeStringTo } from '/imports/lib/store';


export const MainIndex = new Mongo.Collection('index');

// Schema
//
// appId: String
//
// name: String
//
// version: String
//
// packageId: String
//
// imageId: String
//
// webLink: String
//
// codeLink: String
//
// isOpenSource: Boolean
//
// categories: [String]
//
// author: {
//   name: String
//   keybaseUserName: String
//   picture: String
//   githubUserName: String
//   twitterUserName: String
// }
//
// shortDesription: String
//
// upstreamAuthor: String
//
// createdAt: String
//
// versionNumber: Number
//
// ADDED BY CONFLUENCE
//
// uploads: [{type: String, status: String, id: String, errmsg: String}]
//
// sourceId: String


export function processMetadata(app) {
  if (Meteor.isServer) {
    const metadataFile = Files.findOne({appId: app._id, appVersionNumber: app.versionNumber, sourceId: app.sourceId, type: 'metadata'});
    if (!metadataFile) {
      console.log('no metadata file');
      return Promise.resolve(true);
    }
    return new Promise((resolve, reject) => {
      readFileAsString(Config.localFileRoot + metadataFile.path)
      .then((string) => {
        const metadata = JSON.parse(string);
        function addScreenshot(screenshot) {
          Files.insert({appId: app._id, appVersionNumber: app.versionNumber, sourceId: app.sourceId, type: 'image', path: `/images/${screenshot.imageId}`, status: "Absent", errmsg: ""});
        }
        R.map(addScreenshot, metadata.screenshots);
        resolve(true);
      }).catch((err) => {
        // Ignore errors here, we just don't get the screenshots?
        console.log(err);
      })
    })
  } else {
    return Promise.resolve(true);
  }
}

function filesAllFetched(app) {
  const files = Files.find({appId: app.appId, appVersionNumber: app.versionNumber, sourceId: app.sourceId}).fetch();
  const problems = R.reject(R.propEq('status', 'Fetched'), files);
  return (problems.length == 0);
}

function removeApp(app) {
  console.log(`Removing ${app.name}, version ${app.versionNumber}`)
  MainIndex.remove(app._id);
}

export function updateIndex(app) {
  // We might have been processing an update, so deal with that first.
  // We don't have the _id of the app in hand, so we have to do this step first.
  const indexApp = MainIndex.findOne({appId: app.appId});
  if (filesAllFetched(indexApp)) {
    console.log(`Update of ${app.name} successfully fetched, updating index, vn = ${app.versionNumber}`)
    MainIndex.update(app._id, app);
    console.log(`This is where we delete all the old files and the older version of the app`)
    // First, let's find all the older versions of the app in th index collection.
    const allVersions = MainIndex.find({appId: indexApp.appId}).fetch();
    const oldVersions = R.reject(R.propEq('versionNumber', indexApp.versionNumber), allVersions);
    // Now for each old version, delete the package file
    R.map(deleteAssociatedFiles, oldVersions);
    // now remove all the old versions from the index
    R.map(removeApp, oldVersions);
  }

  writeIndex();
}

export function removeAppByName(name) {
  const allVersions = MainIndex.find({name: name}).fetch();
  R.map(deleteAssociatedFiles, allVersions);
  R.map(removeApp, allVersions);

  writeIndex();
}

export function writeIndex() {
  function checkApp(goodApps, app) {
    if (filesAllFetched(app)) {
      return R.append(app, goodApps);
    } else {
      return goodApps;
    }
  }

  const allApps = MainIndex.find().fetch();
  const includedApps = R.reduce(checkApp, [], allApps);
  const string = JSON.stringify({apps: includedApps});
  ensureDirectoryStructure(Config.localFileRoot + '/apps/')
  .then(() => {
    storeStringTo(string, Config.localFileRoot + '/apps/index.json');
  })
}

export function crunchAppStatus(app) {
  function statusReducer(accum, file) {
      if (accum === 'In progress') return 'In progress';
      if (accum === 'Errors') return 'Errors';
      if (accum === 'Needs update') return 'Needs update';
      if (accum === 'Ready') {
        if (file.status === 'Fetching' || file.status === 'Storing') return 'In progress';
        if (file.status === 'Absent') return 'Needs update';
        if (file.status === 'Fetched') return 'Ready';
        return 'Errors';
      }
  }
  const files = Files.find({appId: app._id, appVersionNumber: app.versionNumber, sourceId: app.sourceId}).fetch();
  if (files.length == 0) {
    console.log(`${app.name} is new`);
    return "Needs update";
  }
  return R.reduce(statusReducer, 'Ready', files);
}

if (Meteor.isServer) {
  Meteor.publish("mainIndex", function() {
    return MainIndex.find();
  })
}

export function addFiles(app) {
  const appId = app._id;
  const files = [
    {appId: appId, appVersionNumber: app.versionNumber, sourceId: app.sourceId, type: 'package', path: `packages/${app.packageId}`, status: 'Absent', errmsg: ""},
    {appId: appId, appVersionNumber: app.versionNumber, sourceId: app.sourceId, type: 'metadata', path: `apps/${app.appId}.json`, status: 'Absent', errmsg: ""},
  ];

  if (app.imageId) {
    files.push(
      {appId: appId, appVersionNumber: app.versionNumber, sourceId: app.sourceId, type: 'image', path: `images/${app.imageId}`, status: 'Absent', errmsg: ""},
    )
  };

  function insertFile(file) {
    Files.insert(file);
  }
  // We will need to put screenshots on this list once we fetch metadata.
  R.map(insertFile, files);

}

export function fetchUpdate(updateApp) {
  var existingApp = MainIndex.findOne({appId: updateApp.appId});
  if (!existingApp) {
    // we need to add updateApp to the database
    MainIndex.insert(updateApp);
  } else if (existingApp.versionNumber < updateApp.versionNumber) {
    // we need to update app in the database
    MainIndex.update(existingApp._id, updateApp);
  }
  const packageFile = Files.findOne({appId: updateApp.appId, appVersionNumber: updateApp.versionNumber, type: 'package'});
  if (typeof packageFile == 'undefined') {
    addFiles(updateApp)
  }
  const source = Sources.findOne(updateApp.sourceId);
  const sandstormInfo = SandstormInfo.findOne();
  return fetchAllParts(updateApp, source, sandstormInfo);
}

export function removeDuplicates() {
  const apps = MainIndex.find().fetch();
  const appIdToId = {};
  function verifyApp(app) {
    if (!!appIdToId[app.appId]) {
      MainIndex.remove(app._id);
      console.log(`Removed duplicate of ${app.appId} (${app.name})`)
    } else {
      appIdToId[app.appId] = true;
    }
  }

  R.map(verifyApp, apps);
  writeIndex();
}

Meteor.methods({
  "mainIndex.create"(app) {
    // app is assumed to have source already set.
    const appId = MainIndex.insert(app);
    addFiles(app);
    return appId;
  },

  "mainIndex.update"(id, updater) {
    // id here is app._id, not app.appId
    return MainIndex.update(id, updater);
  },

  "mainIndex.delete"(appId, sourceId) {
    // appId here is app.appId, not app._id
    return MainIndex.remove({appId: appId, sourceId: sourceId});
  },

  "mainIndex.fetch"(id) {
    const app = MainIndex.findOne(id);
    const source = Sources.findOne(app.sourceId);
    const sandstormInfo = SandstormInfo.findOne();
    fetchAllParts(app, source, sandstormInfo);
  },

  "mainIndex.fetchAll"() {
    const apps = MainIndex.find().fetch();
    const sandstormInfo = SandstormInfo.findOne();

    function fetchApp(app) {
      const source = Sources.findOne(app.sourceId);
      fetchAllParts(app, source, sandstormInfo);
    }

    R.map(fetchApp, apps);
  },

  "mainIndex.updateAll"() {
    const apps = MainIndex.find().fetch();
    function needsUpdate(app) {
      const status = crunchAppStatus(app);
      const result = (status !== 'Ready');
      return result;
    }

    const unreadyApps = R.filter(needsUpdate, apps);
    const sandstormInfo = SandstormInfo.findOne();

    function fetchApp(app) {
      const source = Sources.findOne(app.sourceId);
      fetchAllParts(app, source, sandstormInfo);
    }

    R.map(fetchApp, unreadyApps);
  }
})
