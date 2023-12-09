import assert from 'assert';

import { dataError } from './data_error';
import { FSAPI, fileBaseName } from './fsapi';
import { clone, defaultsDeep, inherits } from './util';
import type { DataObject, DeepPartial } from './types';

export type TraitedBaseClass = {
  type_id: string; // will be constant on the prototype
};

export type TraitOpts<TBaseClass extends TraitedBaseClass, TOpts, TState=never> = {
  // eslint-disable-next-line @typescript-eslint/ban-types
  methods?: Partial<Record<string, Function>>;
  properties?: Partial<Record<keyof TBaseClass, unknown>>; // Properties placed on the root of the entity
  default_opts?: TOpts;
  init_prototype?: (opts: TOpts) => void; // Called during load after WebGL/etc initialized
  alloc_state?: (opts: TOpts, obj: TBaseClass) => TState;
  // maybe: exported_opts?: string[]; // opts that are exported onto the root of the entity
};

type OpaqueOpt = { _opaque: 'opaqueopt' };
type OpaqueState = { _opaque: 'opaquestate' };

// These types define the data found in data files, not expected to be used in
// code except for reference / testing.
export type TraitRef = {
  id: string;
} & Partial<Record<string, unknown>>;
export type TypeDef = {
  properties?: Partial<Record<string, unknown>>;
  traits?: TraitRef[];
};

function pascalCase(a: string): string {
  return a.replace(/((?:^|[-_])[a-z])/g, function (token) {
    return token.toUpperCase().replace(/[-_]/g, '');
  });
}

export type TraitFactory<TBaseClass extends TraitedBaseClass, TCtorParam> = TraitFactoryImpl<TBaseClass, TCtorParam>;
class TraitFactoryImpl<TBaseClass extends TraitedBaseClass, TCtorParam> {
  ignore_unknown_traits: boolean = false;
  initialized: boolean = false;

  traits: Partial<Record<string, TraitOpts<TBaseClass, OpaqueOpt, OpaqueState>>> = {};

  registerTrait<TOpts, TState=never>(trait_id: string, opts: TraitOpts<TBaseClass, TOpts, TState>): void {
    assert(!this.initialized);
    assert(!this.traits[trait_id]);
    this.traits[trait_id] = opts as TraitOpts<TBaseClass, OpaqueOpt, OpaqueState>;
  }

  extendTrait<TOpts, TState=never>(trait_id: string, opts: DeepPartial<TraitOpts<TBaseClass, TOpts, TState>>): void {
    assert(!this.initialized);
    let existing = this.traits[trait_id];
    assert(existing);
    this.traits[trait_id] = defaultsDeep(opts, existing);
  }

  name?: string;

  BaseCtor?: Constructor<TBaseClass>;

  private buildConstructor(
    filename: string,
    BaseCtor: Constructor<TBaseClass>,
    type_id: string,
    type_def: TypeDef
  ): void {
    const cap_classes = typeof window === 'undefined';
    let name = `${this.name}${pascalCase(type_id)}`;
    this.BaseCtor = BaseCtor;

    // First, gather any state allocation that needs to be in the constructor
    let traits = type_def.traits || [];
    let state_init = [];
    let factory_param_names = ['BaseCtor'];
    // eslint-disable-next-line @typescript-eslint/ban-types
    let factory_param_values: Function[] = [BaseCtor];
    for (let ii = 0; ii < traits.length; ++ii) {
      let trait_ref = traits[ii];
      assert(trait_ref.id, 'Trait reference missing id');
      let trait_def = this.traits[trait_ref.id];
      if (!trait_def) {
        if (!this.ignore_unknown_traits) {
          dataError(`${filename}: References unknown trait type "${trait_ref.id}"`);
        }
        continue;
      }
      if (trait_def.alloc_state) {
        let pname = `s${factory_param_names.length}`;
        factory_param_names.push(pname);
        factory_param_values.push(trait_def.alloc_state);
        state_init.push(`this.${trait_ref.id}_state=${pname}(this.${trait_ref.id}_opts, this);`);
      }
    }

    let code;
    if (cap_classes) {
      code = `
class ${name} extends BaseCtor {
  constructor() {
    super(...arguments);
    ${state_init.join('\n')}
  }
}`;
    } else {
      code = `
function ${name}() {
  BaseCtor.apply(this, arguments);
  ${state_init.join('\n')}
}`;
    }
    // eslint-disable-next-line no-eval
    let Ctor = eval(`(
function factory(${factory_param_names.join(',')}) {
  return ${code.trim()};
})`).apply(null, factory_param_values);
    if (!cap_classes) {
      inherits(Ctor, BaseCtor);
    }
    let proto = Ctor.prototype;
    proto.type_id = type_id;
    // First attach traits, apply their properties in priority order
    for (let ii = 0; ii < traits.length; ++ii) {
      let trait_ref = traits[ii];
      assert(trait_ref.id); // Checked above
      let trait_def = this.traits[trait_ref.id];
      if (!trait_def) {
        // Checked above
        continue;
      }
      // Properties
      for (let key in trait_def.properties) {
        proto[key] = trait_def.properties[key];
      }
      // Methods - interestingly identical in implementation as properties... Different TypeScript types, though!
      for (let key in trait_def.methods) {
        proto[key] = trait_def.methods[key];
      }
      // Opts
      let num_custom_opts = Object.keys(trait_ref).length - 1; // ignore 'id'
      if (trait_def.default_opts) {
        let opt_key = `${trait_ref.id}_opts`;
        if (num_custom_opts || trait_def.init_prototype) {
          let opts = clone(trait_def.default_opts) as DataObject;
          for (let key in trait_ref) {
            if (key !== 'id') {
              opts[key] = trait_ref[key];
            }
          }
          proto[opt_key] = opts;
        } else {
          proto[opt_key] = trait_def.default_opts;
        }
      } else {
        // Not doing this check: Some traits may have opts used on the client, but not on the server
        // if (num_custom_opts > 0) {
        //   assert(false, `${filename}: Specifies opts for trait that takes none: "${trait_ref.id}"`);
        // }
      }
    }

    // After properties from traits, properties from the definition itself override all
    for (let key in type_def.properties) {
      proto[key] = type_def.properties[key];
    }

    // Finally any run-time initialization that needs to be done (e.g. texture loading, WebGL context references)
    for (let ii = 0; ii < traits.length; ++ii) {
      let trait_ref = traits[ii];
      assert(trait_ref.id); // Checked above
      let trait_def = this.traits[trait_ref.id];
      if (!trait_def) {
        continue; // Checked above
      }
      if (trait_def.init_prototype) {
        let opt_key = `${trait_ref.id}_opts`;
        trait_def.init_prototype(proto[opt_key]);
      }
    }

    // Note: this.ctors[type_id] may already exist, if this is during a reload
    this.ctors[type_id] = Ctor as unknown as Constructor<TBaseClass>;
  }

  initialize(params: {
    name: string;
    fs: FSAPI;
    directory: string;
    ext: string;
    Ctor: Constructor<TBaseClass>;
    reload_cb: (type_id: string) => void;
    ignore_unknown_traits?: boolean;
  }): void {
    let { name, fs, directory, ext, Ctor, reload_cb, ignore_unknown_traits } = params;
    this.ignore_unknown_traits = ignore_unknown_traits || false;
    this.name = name;
    let filenames = fs.getFileNames(directory).filter((a) => a.endsWith(ext));
    let seen_typeids: Record<string, string> = {};
    for (let ii = 0; ii < filenames.length; ++ii) {
      let filename = filenames[ii];
      let type_id = fileBaseName(filename);
      if (seen_typeids[type_id]) {
        assert(false, `Two ${name} data files both define the same type "${type_id}":` +
          ` ${filename} and ${seen_typeids[type_id]}`);
      }
      seen_typeids[type_id] = filename;
      let type_def = fs.getFile<TypeDef>(filename, 'jsobj');
      this.buildConstructor(filename, Ctor, type_id, type_def);
    }

    fs.filewatchOn(ext, (filename: string) => {
      if (!filename.startsWith(directory)) {
        return;
      }
      let type_id = fileBaseName(filename);
      let type_def = fs.getFile<TypeDef>(filename, 'jsobj');
      this.buildConstructor(filename, Ctor, type_id, type_def);
      reload_cb?.(type_id);
    });
    this.initialized = true;
  }

  private ctors: Partial<Record<string, Constructor<TBaseClass>>> = {};

  hasType(type_id: string): boolean {
    return Boolean(this.ctors[type_id]);
  }

  getTypes(): string[] {
    return Object.keys(this.ctors);
  }

  allocate(type_id: string, data: TCtorParam): TBaseClass {
    assert(this.initialized);
    let Ctor = this.ctors[type_id];
    let ret;
    if (!Ctor) {
      dataError(`Missing constructor for ${this.name} type "${type_id}"`);
      assert(this.BaseCtor);
      ret = new this.BaseCtor(data);
      ret.type_id = type_id;
    } else {
      ret = new Ctor(data);
    }
    assert.equal(ret.type_id, type_id); // Otherwise caller probably forgot a `declare` prefix
    return ret;
  }

  getCtorForTesting(type_id: string): Constructor<TBaseClass> {
    let Ctor = this.ctors[type_id];
    assert(Ctor);
    return Ctor;
  }
}

export function traitFactoryCreate<
  TBaseClass extends TraitedBaseClass,
  TCtorParam
>(): TraitFactory<TBaseClass, TCtorParam> {
  return new TraitFactoryImpl();
}
