import * as nodeAssert from 'assert';
import * as crypto from 'crypto';
import ethers from 'ethers';

let DEBUG = false;
export const setDEBUG = (b) => {
  if (b === false || b === true) {
    DEBUG = b;
  } else {
    throw Error(`Expected bool, got ${JSON.stringify(b)}`);
  }
};
export const getDEBUG = () => { return DEBUG; };
export const debug = msg => {
  if (getDEBUG()) {
    console.log(`DEBUG: ${msg}`);
  }
};

// Hex helpers
// const un0x           = h => h.replace(/^0x/, ''); // unused
const hexTo0x = h => '0x' + h.replace(/^0x/, '');
const byteToHex = b => (b & 0xFF).toString(16).padStart(2, '0');
const byteArrayToHex = b => Array.from(b, byteToHex).join('');

// const hexOf = x =>
//       typeof x === 'string' && x.slice(0, 2) === '0x'
//       ? un0x(toHex(x))
//       : un0x(toHex(`0x${x}`));
const hexOf = x => toHex(x);
// TODO: why was this stripping off the 0x?
// Why was it slapping 0x on non-hex strings?

// Contracts

// .name is used for error display purposes only
// .canonicalize turns stuff into the "canonical backend representation"
// .munge expects a canonicalized value, and "munges" it for sending to the network
// .unmunge is the inverse of .munge
// TODO: decouple .munge and .unmunge from this module

export const T_Null = {
  name: 'Null',
  canonicalize: (v) => {
    // Doesn't check with triple eq; we're being lenient here
    if (v != null) {
      throw Error(`Expected null, but got ${JSON.stringify(v)}`);
    }
    return null;
  },
  // TODO: is this needed?
  munge: (v) => {void(v); return false;},
  unmunge: (v) => {void(v); return null;},
};

export const T_Bool = {
  name: 'Bool',
  canonicalize: (v) => {
    if (typeof(v) !== 'boolean') {
      throw Error(`Expected boolean, but got ${JSON.stringify(v)}`);
    }
    return v;
  },
  munge: (v) => v,
  unmunge: (v) => v,
};

export const T_UInt256 = {
  name: 'UInt256',
  canonicalize: (v) => {
    if (isBigNumber(v)) {
      return v;
    }
    if (typeof(v) === 'number') {
      return bigNumberify(v);
    }
    if (typeof(v) === 'string') {
      if (v.slice(0,2) == '0x' && v.length == 66) {
        // TODO: also check it is entirely 0-9 a-f
        return bigNumberify(v);
      } else {
        throw Error(`String does not represent a BigNumber. ${JSON.stringify(v)}`);
      }
    }
    throw Error(`Expected BigNumber or number, but got ${JSON.stringify(v)}`);
  },
  munge: (v) => v,
  // TODO: double check:
  // It looks like munging BigNumber to string is no longer needed?
  // munge: (v) => v.toString(),
  unmunge: (v) => v,
};

export const T_Bytes = {
  name: 'Bytes',
  canonicalize: (x) => {
    if (typeof(x) !== 'string') {
      throw Error(`Bytes expected string, but got ${JSON.stringify(x)}`);
    }
    if (isHex(x)) {
      return x;
    } else {
      return toHex(x);
      // TODO: fix things so this restriction is not necessary
      // throw Error(`Please use toHex on string sent to Reach: "${x}"`);
    }
  },
  munge: (v) => v,
  unmunge: (v) => v,
};

export const T_Address = {
  name: 'Address',
  canonicalize: (x) => {
    if (typeof x !== 'string') {
      throw Error(`Address must be a string, but got: ${JSON.stringify(x)}`);
    }
    if (x.slice(0, 2) !== '0x') {
      throw Error(`Address must start with 0x, but got: ${JSON.stringify(x)}`);
    }
    if (!isHex(x)) {
      throw Error(`Address must be a valid hex string, but got: ${JSON.stringify(x)}`);
    }
    // TODO check address length?
    return x;
  },
  munge: (v) => v,
  unmunge: (v) => v,
};

export const T_Array = (ctc, sz) => {
  // TODO: check ctc, sz for sanity
  return {
    name: `Array(${ctc.name}, ${sz})`,
    canonicalize: (args) => {
      if (!Array.isArray(args)) {
        throw Error(`Expected an Array, but got ${JSON.stringify(args)}`);
      }
      if (sz != args.length) {
        throw Error(`Expected array of length ${sz}, but got ${args.length}`);
      }
      return args.map((arg) => ctc.canonicalize(arg));
    },
    munge: (v) => {
      return v.map((arg) => ctc.munge(arg));
    },
    unmunge: (v) => {
      return v.map((arg) => ctc.unmunge(arg));
    },
  };
};

export const T_Tuple = (ctcs) => {
  // TODO: check ctcs for sanity
  return {
    name: `Tuple(${ctcs.map((ctc) => ` ${ctc.name} `)})`,
    canonicalize: (args) => {
      if (!Array.isArray(args)) {
        throw Error(`Expected a Tuple, but got ${JSON.stringify(args)}`);
      }
      if (ctcs.length != args.length) {
        throw Error(`Expected tuple of size ${ctcs.length}, but got ${args.length}`);
      }
      return args.map((arg, i) => ctcs[i].canonicalize(arg));
    },
    munge: (args) => {
      return args.map((arg, i) => ctcs[i].munge(arg));
    },
    unmunge: (args) => {
      return args.map((arg, i) => ctcs[i].unmunge(arg));
    },
  };
};

export const T_Object = (co) => {
  // TODO: check co for sanity
  return {
    name: `Object(${Object.keys(co).map((k) => ` ${k}: ${co[k].name} `)})`,
    canonicalize: (vo) => {
      if (typeof(vo) !== 'object') {
        throw Error(`Expected object, but got ${JSON.stringify(vo)}`);
      }
      const obj = {};
      for (const prop in co) {
        // This is dumb but it's how ESLint says to do it
        // https://eslint.org/docs/rules/no-prototype-builtins
        if (!{}.hasOwnProperty.call(vo, prop)) {
          throw Error(`Expected prop ${prop}, but didn't found it in ${Object.keys(vo)}`);
        }
        obj[prop] = co[prop].canonicalize(vo[prop]);
      }
      return obj;
    },
    munge: (vo) => {
      const obj = {};
      for (const prop in co) {
        obj[prop] = co[prop].munge(vo[prop]);
      }
      return obj;
    },
    // TODO: reduce duplication somehow
    unmunge: (vo) => {
      const obj = {};
      for (const prop in co) {
        obj[prop] = co[prop].unmunge(vo[prop]);
      }
      return obj;
    },
  };
};

export const T_Data = (co) => {
  // TODO: check co for sanity
  // ascLabels[i] = label
  // labelMap[label] = i
  const ascLabels = Object.keys(co).sort();
  const labelMap = {};
  for (const i in ascLabels) {
    labelMap[ascLabels[i]] = i;
  }
  return {
    name: `Data(${Object.keys(co).map((k) => ` ${k}: ${co[k].name} `)})`,
    canonicalize: (io) => {
      if (!(Array.isArray(io) && io.length == 2)) {
        throw Error(`Expected an array of length two to represent a data instance, but got ${JSON.stringify(io)}`);
      }
      const vn = io[0];
      if (!{}.hasOwnProperty.call(co, vn)) {
        throw Error(`Expected a variant in ${Object.keys(co)}, but got ${vn}`); }
      return [ vn, co[vn].canonicalize(io[1]) ];
    },
    munge: ([label, v]) => {
      console.log(`XXX munging [${label}, ${v}]`);
      return [labelMap[label], co[label].munge(v)];
    },
    unmunge: ([i, v]) => {
      console.log(`XXX unmunhging [${i}, ${v}]`);
      const label = ascLabels[i];
      return [label, co[label].unmunge(v)];
    },
  };
};

const format_ai = (ai) => JSON.stringify(ai);

export const protect = (ctc, v, ai = null) => {
  try {
    return ctc.canonicalize(v);
  } catch (e) {
    console.log(`Protect failed: expected ${ctc.name} but got ${JSON.stringify(v)}${format_ai(ai)}`);
    throw e;
  }
};

export const assert = (d, ai = null) =>
  nodeAssert.strict(d, format_ai(ai));

const {
  hexlify,
  toUtf8Bytes,
  toUtf8String,
  isHexString,
} = ethers.utils;
const { BigNumber } = ethers;
export const { isBigNumber } = BigNumber;
export const bigNumberify = (x) => BigNumber.from(x);


// Massage the arg into a form keccak256 will handle correctly
const kek = (arg) => {
  if (typeof(arg) === 'string') {
    if (isHex(arg)) {
      return arg;
    } else {
      return toUtf8Bytes(arg);
    }
  } else if (typeof(arg) === 'number') {
    return '0x' + bigNumberToHex(arg);
  } else if (isBigNumber(arg)) {
    return '0x' + bigNumberToHex(arg);
  } else if (arg && arg.constructor && arg.constructor.name == 'Uint8Array') {
    return arg;
  } else if (Array.isArray(arg)) {
    return ethers.utils.concat(arg.map(kek).map(ethers.utils.arrayify));
  } else {
    throw Error(`Can't kek this: ${arg}`);
  }
};

export const toHex = (x) => hexlify(kek(x));
export const isHex = isHexString;
export const hexToString = toUtf8String;

export const keccak256 = (...args) => {
  const kekCat = kek(args);
  return ethers.utils.keccak256(kekCat);
};

export const hexToBigNumber = h => bigNumberify(hexTo0x(h));
export const uint256ToBytes = i => bigNumberToHex(i);

export const bigNumberToHex = (u) => {
  const size = 32; // bytes // TODO: support other sizes?
  const format = 'ufixed256x0';
  const nPos = bigNumberify(u).toTwos(8 * size);
  // They took away padZeros so we have to use FixedNumber
  const nFix = ethers.FixedNumber.from(nPos.toString(), format);
  // XXX why do we slice off the 0x?
  return hexlify(nFix).slice(2);
};

export const bytesEq = (x, y) =>
  hexOf(x) === hexOf(y);

export const randomUInt256 = () =>
  hexToBigNumber(byteArrayToHex(crypto.randomBytes(32)));

export const hasRandom = {
  random: randomUInt256,
};

export const eq = (a, b) => bigNumberify(a).eq(bigNumberify(b));
export const add = (a, b) => bigNumberify(a).add(bigNumberify(b));
export const sub = (a, b) => bigNumberify(a).sub(bigNumberify(b));
export const mod = (a, b) => bigNumberify(a).mod(bigNumberify(b));
export const mul = (a, b) => bigNumberify(a).mul(bigNumberify(b));
export const div = (a, b) => bigNumberify(a).div(bigNumberify(b));
export const ge = (a, b) => bigNumberify(a).gte(bigNumberify(b));
export const gt = (a, b) => bigNumberify(a).gt(bigNumberify(b));
export const le = (a, b) => bigNumberify(a).lte(bigNumberify(b));
export const lt = (a, b) => bigNumberify(a).lt(bigNumberify(b));

// Array helpers

export function Array_set(arr, idx, elem) {
  const arrp = arr.slice();
  arrp[idx] = elem;
  return arrp;
}

export const Array_zip =
  (x, y) => x.map((e, i) => [e, y[i]]);
