import Ajv from 'ajv';
import {readFile} from 'fs/promises';
import yaml from 'js-yaml';
import {OpviousClient} from 'opvious';
import os from 'os';
import path from 'path';
import {DeepWritable} from 'ts-essentials';

export interface Config {
  readonly profileName: string;
  readonly client: OpviousClient;
}

export async function loadConfig(params: LoadConfigParams): Promise<Config> {
  const env = params.env ?? process.env;
  const dpath = env[CONFIG_DPATH_EVAR] ?? DEFAULT_CONFIG_DPATH;

  const {profiles} = await loadConfigFile(dpath);
  let profile: Profile | undefined;
  if (params.profile) {
    profile = profiles.find((p) => p.name === params.profile);
  } else {
    profile = profiles[0];
  }
  if (!profile) {
    throw new Error('Unknown or missing profile');
  }
  const accessToken = profile.accessToken.startsWith('$')
    ? process.env[profile.accessToken.substring(1)]
    : profile.accessToken;
  return {
    profileName: profile.name,
    client: OpviousClient.create({accessToken}),
  };
}

export interface LoadConfigParams {
  readonly env?: {readonly [evar: string]: string};
  readonly profile?: string;
}

interface ConfigFile {
  readonly profiles: ReadonlyArray<Profile>;
}

const ajv = new Ajv();

interface Profile {
  readonly name: string;
  readonly accessToken: string;
}

const validate = ajv.compile<DeepWritable<ConfigFile>>({
  type: 'object',
  required: ['profiles'],
  properties: {
    profiles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'accessToken'],
        properties: {
          name: {type: 'string'},
          accessToken: {type: 'string'},
        },
      },
    },
  },
});

const CONFIG_DPATH_EVAR = 'OPVIOUS_CONFIG';
const DEFAULT_CONFIG_DPATH = path.join(os.homedir(), '.config', 'opvious');
const CONFIG_FNAME = 'cli.yml';

async function loadConfigFile(dp: string): Promise<ConfigFile> {
  const fp = path.join(dp, CONFIG_FNAME);
  let str;
  try {
    str = await readFile(fp, 'utf8');
  } catch (err: any) {
    throw new Error(`Unable to load config file at ${fp}: ${err.message}`);
  }
  const obj = yaml.load(str);
  if (validate(obj)) {
    return obj;
  }
  throw new Error(ajv.errorsText(validate.errors));
}
