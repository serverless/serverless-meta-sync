'use strict';

/**
 * Serverless Meta Sync Plugin
 * - Sync your variables via S3 bucket
 */

const path  = require('path'),
  fs        = require('fs'),
  _        = require('lodash'),
  BbPromise = require('bluebird');

module.exports = function(S) {
  const SError = require(S.getServerlessPath('Error'));
  const SCli = require(S.getServerlessPath('utils/cli'));
  const diffString = require('json-diff').diffString;

  class MetaSync extends S.classes.Plugin {

    constructor() {
      super();
      this.name = 'metaSync'; // Define your plugin's name
    }

    registerActions() {

      S.addAction(this.metaSync.bind(this), {
        handler:       'metaSync',
        description:   'A custom action from a custom plugin',
        context:       'meta',
        contextAction: 'sync',
        options:       [
          {
            option:      'stage',
            shortcut:    's',
            description: 'Optional if only one stage is defined in project'
          }, {
            option:      'region',
            shortcut:    'r',
            description: 'Optional - Target one region to deploy to'
          },
        ],
        parameters: []
      });

      return BbPromise.resolve();
    }


    metaSync(evt) {
      this.evt = evt;
      return this._validateAndPrepare().bind(this)
        .then(this._sync)
        .then(() => {
          SCli.log(`Done`);
          return this.evt;
        })
    }

    getKey() {
      return '_servereless_meta_sync/variables/' + this.syncFileName;
    }

    _validateAndPrepare() {
      const stage = this.evt.options.stage;
      const region = this.evt.options.region;
      const proj = S.getProject();

      // validate options
      if (stage && !proj.validateStageExists(stage)) {
        return BbPromise.reject(new SError(`Stage ${stage} doesnt exist in this project!`))
      }

      if (!stage && region) {
        return BbPromise.reject(new SError(`Stage is required when you specify a region!`))
      }

      if (stage && region && !proj.validateRegionExists(stage, region)) {
        return BbPromise.reject(new SError(`Region ${region} doesnt exist in stage ${stage}!`))
      }

      // loading config
      this.config = _.get(proj.toObjectPopulated({stage, region}), 'custom.meta');
      if (!this.config) return BbPromise.reject(new SError(`Meta Sync config must be defined in "s-project.json"!`));

      // validate config
      if (_.isEmpty(this.config.name)) return BbPromise.reject(new SError(`Missing config property "name"!`));
      if (_.isEmpty(this.config.region)) return BbPromise.reject(new SError(`Missing config property "region"!`));

      // set the file name to sync
      if (stage && region) this.syncFileName = `s-variables-${stage}-${S.classes.Region.regionNameToVarsFilename(region)}.json`;
      else if (stage) this.syncFileName = `s-variables-${stage}.json`;
      else this.syncFileName = 's-variables-common.json';

      // get local version
      this.localVersion = S.utils.readFileSync(proj.getRootPath('_meta', 'variables', this.syncFileName));

      // get remote version
      const params = {
        Bucket: this.config.name,
        Key: this.getKey()
      };

      return S.getProvider('aws').request('S3', 'getObject', params, stage, this.config.region)
        .catch({code: 'NoSuchBucket'}, e => {
          this.bucketDoesntExist = true;
          return;
        })
        .catch({code: 'NoSuchKey'}, e => {} )
        .then(reply => this.remoteVersion = JSON.parse((new Buffer(reply.Body)).toString()))
    }

    _sync() {
      if (!this.remoteVersion && !this.localVersion) {
        SCli.log(`${this.syncFileName} dosn't exist locally nor on S3`);
        return;
      }

      if (this.remoteVersion && !this.localVersion) {
        SCli.log(`Creating local copy of ${this.syncFileName}...`);
        return S.utils.writeFile(proj.getRootPath('_meta', 'variables', this.syncFileName), this.remoteVersion);
      }

      if (!this.remoteVersion && this.localVersion) {
        SCli.log(`Creating remote copy of ${this.syncFileName}...`);
        return this._updateRemote();
      }


      if (S.config.interactive) {
        return this._diff();
      } else {
        // When used programmatically, it should simply overwrite
        // the local project variables with the variables on the S3 Bucket
        return this._updateLocal();
      }
    }

    _updateLocal() {
      const proj = S.getProject();

      S.utils.sDebug(`Overwrite "${this.syncFileName}" with the remote version`);
      return S.utils.writeFile(proj.getRootPath('_meta', 'variables', this.syncFileName), this.remoteVersion);
    }

    _updateRemote() {
      const stage = this.evt.options.stage;
      const region = this.config.region;

      return BbPromise.try(() => {
        // create a bucket if it doesn't exist
        if (!this.bucketDoesntExist) return;

        S.utils.sDebug(`Creating new bucket "${this.config.name}" in "${region}"`);

        const params = {Bucket: this.config.name};

        return S.getProvider('aws').request('S3', 'createBucket', params, stage, region);
      })
      .then(() => {
        const params = {
          Bucket: this.config.name,
          Key: this.getKey(),
          Body: JSON.stringify(this.localVersion)
        };

        S.utils.sDebug(`Uploading "${this.syncFileName}" to S3`);

        S.getProvider('aws').request('S3', 'putObject', params, stage, region);
      });
    }

    _diff() {
      const difference = diffString(this.localVersion, this.remoteVersion);

      if (difference.trim() === 'undefined') {
        SCli.log('Resource templates are equal. There is nothing to sync.');
        return;
      }

      process.stdout.write(difference);
      process.stdout.write("\n");

      const choices = [
        {
          key: '',
          value: "remote",
          label: "Apply this changes to local version"
        },
        {
          key: '',
          value: "local",
          label: "Discard this changes and sync remote version with the local one"
        }
      ];

      return this.cliPromptSelect(`How to handle this difference?`, choices, false)
        .then(values => values[0].value)
        .then(choice => {
          if (choice === 'local') {
            return this._updateRemote();
          }
          else {
            return this._updateLocal();
          }
        });
    }

  }

  return MetaSync;

};