import { R } from 'meteor/ramda:ramda';

import { downloadAppIndex } from '/imports/lib/sandstorm';
import { MainIndex, addFiles } from '/imports/api/mainIndex';
import { Sources } from '/imports/api/sources';


export function downloadSource(sourceRef) {
  const id = Sources.insert({name: sourceRef.name, baseUrl: sourceRef.baseUrl, status: 'Initializing'});
  const source = Sources.findOne(id);

  function setIncluded(app) {
    app.included = appIsIncluded(app);
    return app;
  }

  function appIsIncluded(app) {
    console.log(`checking to see if ${app.name} is included`)
    function appSpecified(accum, srcApp) {
      if (accum) return true;
      return (srcApp.name === app.name)
    }
    const result = R.reduce(appSpecified, false, sourceRef.apps);
    console.log(result);
    return result;
  }

  return new Promise((resolve, reject) => {
    downloadAppIndex(source)
    .then((result) => {
      const updatedApps = R.map(setIncluded, result.data.apps)
      Sources.update(id, {$set: {downloadStatus: 'Fetched', apps: updatedApps, timestamp: new Date(Date.now()).toUTCString(), errorMessage: null}});

      console.log(`finished with ${sourceRef.name}`)
    })
    .catch((error) => {
      Sources.update(id, {$set: {downloadStatus: 'Error', errorMessage: error.toString()}});
      reject(false);
    })
    .then(() => {
      const src = Sources.findOne(id);
      const includedApps = R.filter(appIsIncluded, src.apps)
      function addApp(app) {
        app.sourceId = src._id;
        app._id = MainIndex.insert(app);
      }

      R.map(addApp, includedApps);

      R.map(addFiles, includedApps);

      resolve(true);
    })
  });
}
