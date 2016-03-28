# [Serverless](http://serverless.com/) Meta Sync Plugin

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)

Secure syncing of Serverless project's meta data across teams (via S3 bucket).

## Demo
[![asciicast](https://asciinema.org/a/40566.png)](https://asciinema.org/a/40566)

## Setup

* Install via npm in the root of your Serverless Project:
```
npm install serverless-meta-sync --save
```

* Add the plugin to the `plugins` array and to the `custom` object in your Serverless Project's `s-project.json`, like this:

```
"custom": {
  "meta": {
    "name": "YOUR_SYNC_S3_BUCKET_NAME",
    "region": "S3_BUCKET_REGION"
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
* `-s` `--stage` — Stage. Optional if only one stage is defined in project.
* `-r` `--region` — Region. Optional.
