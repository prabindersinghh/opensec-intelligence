const fs = require('fs');

function readConfig(path, callback) {
  fs.readFile(path, 'utf-8', (err, data) => {
    if (err) return callback(err);
    try {
      callback(null, JSON.parse(data));
    } catch (e) {
      callback(e);
    }
  });
}

function writeConfig(path, data, callback) {
  const json = JSON.stringify(data, null, 2);
  fs.writeFile(path, json, (err) => {
    callback(err);
  });
}

module.exports = { readConfig, writeConfig };
