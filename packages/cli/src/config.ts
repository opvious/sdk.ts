import {default as Ajv_} from 'ajv';
import {readFile} from 'fs/promises';
import {OpviousClient} from 'opvious';
import os from 'os';
import path from 'path';
import {DeepWritable} from 'ts-essentials';
import YAML from 'yaml';

import {telemetry} from './common.js';

const {logger} = telemetry;

const Ajv = Ajv_.default ?? Ajv_;

export interface Config {
  readonly profileName?: string;
  readonly client: OpviousClient;
  readonly token?: string;
  readonly dockerCommand?: string;
  readonly notebooksFolder?: string;
}

export async function loadConfig(args: {
  readonly profile?: string;
  readonly env?: {readonly [evar: string]: string};
}): Promise<Config> {
  logger.debug({data: {profile: args.profile}}, 'Loading config...');

  const env = args.env ?? process.env;
  const dpath = env[CONFIG_DPATH_EVAR] ?? DEFAULT_CONFIG_DPATH;
  const cfgFile = await loadConfigFile(dpath);

  let token: string | undefined;
  let profile: Profile | undefined;
  if (env.OPVIOUS_TOKEN != null && !args.profile) {
    token = env.OPVIOUS_TOKEN;
  } else if (cfgFile) {
    if (args.profile) {
      profile = cfgFile.profiles.find((p) => p.name === args.profile);
    } else {
      profile = cfgFile.profiles[0];
    }
    if (!profile) {
      throw new Error('Unknown or missing profile');
    }
    token = profile.token?.startsWith('$')
      ? env[profile.token.substring(1)]
      : profile.token;
  }

  return {
    profileName: profile?.name,
    client: OpviousClient.create({
      token,
      endpoint: profile ? profile.endpoint ?? false : undefined,
      telemetry,
    }),
    token,
    dockerCommand: cfgFile?.dockerCommand,
  };
}

interface ConfigFile {
  readonly profiles: ReadonlyArray<Profile>;
  readonly dockerCommand?: string;
}

const ajv = new Ajv();

interface Profile {
  readonly name: string;
  readonly token?: string;
  readonly endpoint?: string;
}

const validate = ajv.compile<DeepWritable<ConfigFile>>({
  type: 'object',
  required: ['profiles'],
  properties: {
    profiles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {type: 'string'},
          token: {type: 'string'},
          endpoint: {type: 'string'},
        },
      },
    },
    dockerCommand: {
      type: 'string',
    },
    notebooksFolder: {
      type: 'string',
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
  const obj = YAML.parse(str);
  if (validate(obj)) {
    return obj;
  }
  throw new Error(ajv.errorsText(validate.errors));
}
