'use strict';

/**
 * Serverless Meta Sync Plugin
 * - Sync your variables via S3 bucket
 */

const prefix = (pfx, str) => str.split('\n').map(line => pfx + line).join('\n');

const path  = require('path'),
  fs        = require('fs'),
  _        = require('lodash'),
  chalk     = require('chalk'),
  BbPromise = require('bluebird');

module.exports = function(S) {
  const SError = require(S.getServerlessPath('Error'));
  const SCli = require(S.getServerlessPath('utils/cli'));
  const diffString = require('json-diff').diffString;
  const diff = require('json-diff').diff;

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
      return this._prompt()
        .bind(this)
        .then(this._validateAndPrepare)
        .then(this._sync)
        .then(() => {
          SCli.log(`Done`);
          return this.evt;
        })
    }

    getKey() {
      return '_servereless_meta_sync/variables/' + this.syncFileName;
    }


    /**
     * Prompt stage and region
     */

    _prompt() {
      // Skip if non-interactive or stage is provided
      if (!S.config.interactive || this.evt.options.stage) return BbPromise.resolve();

      if (!S.getProject().getAllStages().length) return BbPromise.reject(new SError('No existing stages in the project'));

      return this.cliPromptSelectStage('Select an existing stage: ', this.evt.options.stage, false)
        .then(stage => this.evt.options.stage = stage)
    }


    _validateAndPrepare() {
      const stage = this.evt.options.stage;
      const region = this.evt.options.region;
      const proj = S.getProject();

      // validate options

      if (!stage) {
        return BbPromise.reject(new SError(`Stage is required!`))
      }

      if (stage && !proj.validateStageExists(stage)) {
        return BbPromise.reject(new SError(`Stage ${stage} doesnt exist in this project!`))
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
        .then(reply => {
          if (reply) this.remoteVersion = JSON.parse((new Buffer(reply.Body)).toString());
        })
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

    _updateLocal(data) {
      const proj = S.getProject();

      S.utils.sDebug(`Overwrite "${this.syncFileName}" with the remote version`);
      return S.utils.writeFile(proj.getRootPath('_meta', 'variables', this.syncFileName), data || this.remoteVersion);
    }

    _updateRemote(data) {
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
          Body: JSON.stringify(data || this.localVersion)
        };

        S.utils.sDebug(`Uploading "${this.syncFileName}" to S3`);

        S.getProvider('aws').request('S3', 'putObject', params, stage, region);
      });
    }

    _diff() {
      const difference = diffString(this.localVersion, this.remoteVersion);

      SCli.log(`Going to sync "${this.syncFileName}"... \n`);

      if (difference.trim() === 'undefined') {
        SCli.log('Resource templates are equal. There is nothing to sync.');
        return;
      }

      process.stdout.write(difference);
      process.stdout.write("\n");

      const choices = [
        {
          value: "oneByOne",
          label: "Review these changes one by one"
        },
        {
          value: "remote",
          label: "Apply these changes to local version"
        },
        {
          value: "local",
          label: "Discard these changes and sync the remote version with the local one"
        },
        {
          value: "cancel",
          label: "Cancel"
        }
      ];

      return this.cliPromptSelect(`How to handle this difference?`, choices, false)
        .then(values => values[0].value)
        .then(choice => {
          switch (choice) {
            case 'local':
              return this._updateRemote();
            case 'remote':
              return this._updateLocal();
            case 'oneByOne':
              return this._updateOneByOne();
          }
        });
    }

    _updateOneByOne() {
      const out = _.assign({}, this.localVersion);
      let difference = diff(this.localVersion, this.remoteVersion);

      return BbPromise.each(_.keys(difference), (key, i, len) => {
        process.stdout.write(chalk.gray(`\n----------------------------------------\nChange ${++i} of ${len}\n\n`));

        const value = difference[key];
        let propName, action;

        if (key.endsWith('__deleted')) {
          action = 'delete';
          propName = key.replace('__deleted', '')
          console.log(chalk.red.bold('Delete:'));
          console.log(chalk.red(prefix('-  ', `${propName}: ${JSON.stringify(value)}`)));
        } else if (key.endsWith('__added')) {
          action = 'add';
          propName = key.replace('__added', '')
          console.log(chalk.green.bold('Add:'));
          console.log(chalk.green(prefix('+  ', `${propName}: ${JSON.stringify(value)}`)));
        } else if (value.__old && value.__new) {
          action = 'update';
          console.log(chalk.yellow.bold('Update:'));
          console.log(chalk.dim('Old:'));
          console.log(chalk.red(prefix('-  ', `${key}: ${JSON.stringify(value.__old, null, 2)}`)));
          console.log(chalk.dim('New:'));
          console.log(chalk.green(prefix('+  ', `${key}: ${JSON.stringify(value.__new, null, 2)}`)));
        }

        process.stdout.write('\n');
        return this._promptChangeAction()
          .then(applyChange => {
            if (!applyChange) return;

            if (action === 'delete') delete out[propName];
            else if (action === 'add') out[propName] = value;
            else if (action === 'update') out[key] = value.__new;
          })
      })
      .then(() => {
        process.stdout.write(chalk.gray('\n----------------------------------------\n\n'));

        SCli.log('Please, review the selected changes:\n');
        console.log(diffString(this.localVersion, out));

        const choices = [
          {value: true, label: "Yes"},
          {value: false, label: "Cancel"}
        ];

        return this.cliPromptSelect("Apply these changes to the local version and update the remote one?", choices, false)
          .then(values => values[0].value)
          .then(applyChanges => {
            return applyChanges && BbPromise.all([
              this._updateLocal(out),
              this._updateRemote(out)
            ]);
          })
          .then(() => this.evt.data.out = out);
      })
    }

    _promptChangeAction() {
      const choices = [
        {label: "Yes", value: true},
        {label: "No", value: false}
      ];

      return this.cliPromptSelect('Apply this change?', choices, false)
        .then(values => values[0].value)
    }
  }


  return MetaSync;

};