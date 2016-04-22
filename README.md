# [Serverless](http://serverless.com/) Meta Sync Plugin

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![gitter](https://img.shields.io/gitter/room/serverless/serverless.svg)](https://gitter.im/serverless/serverless)
[![version](https://img.shields.io/npm/v/serverless-meta-sync.svg)](https://www.npmjs.com/package/serverless-meta-sync)
[![downloads](https://img.shields.io/npm/dm/serverless-meta-sync.svg)](https://www.npmjs.com/package/serverless-meta-sync)
[![dependencies](https://img.shields.io/david/serverless/serverless-meta-sync.svg)](https://www.npmjs.com/package/serverless-meta-sync)
[![license](https://img.shields.io/npm/l/serverless-meta-sync.svg)](https://www.npmjs.com/package/serverless-meta-sync)

Secure syncing of Serverless project's meta data across teams (via S3 bucket).

This plugin adds a `serverless meta sync` command.  When you run it with a stage or a region `-s dev -r us-east-1`, this plugin will first find or create an S3 bucket using the credentials you have set for that stage, then sync the variables files you have locally with the ones on the S3 bucket.  For example, running `serverless meta sync -s dev` will sync your project's `s-variables-dev.json` with the `s-variables-dev.json` located on the S3 bucket.

When used via the CLI and conflicts are found, an interactive screen will let easily you select which option to use.  When used without the CLI, the files located remotely automatically overwrite the files located locally, which is useful when used in the beginning of CI processes.

## Demo
[![asciicast](https://asciinema.org/a/40566.png)](https://asciinema.org/a/40566)

## Setup

* Install via npm in the root of your Serverless Project:
```
npm install serverless-meta-sync --save
```

* Add the plugin to the `plugins` array and to the `custom` object in your Serverless Project's `s-project.json`, like this:

```js
"custom": {
  "meta": {
    "name": "YOUR_SYNC_S3_BUCKET_NAME",
    "region": "S3_BUCKET_REGION",

    // Optional, by default: "serverless/PROJECT_NAME/variables/"
    "keyPrefix": "S3_KEY_PREFIX"
  }
},
"plugins": [
    "serverless-meta-sync"
]
```

* All done!

## Usage
Run: `serverless meta sync`.

### Options
* `-s` `--stage` — Stage. Optional if only one stage is defined in project. This will only sync the variables file of the specified stage (e.g., `s-variables-dev.json`).
* `-r` `--region` — Region. Optional. This will only sync the variables file for the specified region in the specified stage (e.g., `s-variables-dev-useast1.json`).
* `-f` `--from-remote` — Optional. Explicitly sync remote variables to local.
* `-t` `--to-remote` — Optional. Explicitly sync local variables to remote.
