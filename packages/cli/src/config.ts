import Ajv from 'ajv';
import {readFile} from 'fs/promises';
import yaml from 'js-yaml';
import {OpviousClient} from 'opvious';
import os from 'os';
import path from 'path';
import {DeepWritable} from 'ts-essentials';

import {telemetry} from './common';

const {logger} = telemetry;

export interface Config {
  readonly profileName?: string;
  readonly client: OpviousClient;
}

export async function loadConfig(args: {
  readonly profile?: string;
  readonly env?: {readonly [evar: string]: string};
}): Promise<Config> {
  logger.debug({data: {profile: args.profile}}, 'Loading config...');

  const env = args.env ?? process.env;
  const dpath = env[CONFIG_DPATH_EVAR] ?? DEFAULT_CONFIG_DPATH;

  const cfgFile = await loadConfigFile(dpath);
  let auth: string | undefined;
  let profile: Profile | undefined;
  if (cfgFile) {
    if (args.profile) {
      profile = cfgFile.profiles.find((p) => p.name === args.profile);
    } else {
      profile = cfgFile.profiles[0];
    }
    if (!profile) {
      throw new Error('Unknown or missing profile');
    }
    auth = profile.authorization.startsWith('$')
      ? process.env[profile.authorization.substring(1)]
      : profile.authorization;
  } else {
    auth = process.env.OPVIOUS_AUTHORIZATION;
  }
  return {
    profileName: profile?.name,
    client: OpviousClient.create({authorization: auth, telemetry}),
  };
}

interface ConfigFile {
  readonly profiles: ReadonlyArray<Profile>;
}

const ajv = new Ajv();

interface Profile {
  readonly name: string;
  readonly authorization: string;
}

const validate = ajv.compile<DeepWritable<ConfigFile>>({
  type: 'object',
  required: ['profiles'],
  properties: {
    profiles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'authorization'],
        properties: {
          name: {type: 'string'},
          authorization: {type: 'string'},
        },
      },
    },
  },
});

const CONFIG_DPATH_EVAR = 'OPVIOUS_CONFIG';
const DEFAULT_CONFIG_DPATH = path.join(os.homedir(), '.config', 'opvious');
const CONFIG_FNAME = 'cli.yml';

async function loadConfigFile(dp: string): Promise<ConfigFile | undefined> {
  const fp = path.join(dp, CONFIG_FNAME);
  let str;
  try {
    str = await readFile(fp, 'utf8');
  } catch (err) {
    logger.info({err}, 'Unabled to load config from %s.', fp);
    return undefined;
  }
  logger.info('Loaded config from %s.', fp);
  const obj = yaml.load(str);
  if (validate(obj)) {
    return obj;
  }
  throw new Error(ajv.errorsText(validate.errors));
}
