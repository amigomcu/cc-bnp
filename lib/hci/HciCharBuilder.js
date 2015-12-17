'use strict';

var Q = require('q'),
    _ = require('lodash'),
    Concentrate = require('concentrate'),
    hciCharMeta = require('./HciCharMeta');

var nibbleBuf = [];

function hciCharBuilder (uuid) {
    return ValObj.factory(uuid);
}

/***************************************************************************************************/
/*** ValObj Class                                                                                ***/
/***************************************************************************************************/
function ValObj() {}

ValObj.factory = function (uuid) {
    var charValsMeta;

    if (_.isObject(uuid)) {
        ValObj.multi = function () {
            this.uuid = uuid;
        };

        if (!_.isFunction(ValObj.multi.prototype.getCharValPacket)) {
            ValObj.multi.prototype = new ValObj();
        }

        return new ValObj.multi();
    } else {
        charValsMeta = hciCharMeta[uuid];

        ValObj[uuid] = function () {
            this.uuid = uuid;
            ValObj[uuid].charVals = ValObj[uuid].charVals || charValsMeta;
        };

        if (!_.isFunction(ValObj[uuid].prototype.getCharVals)) {
            ValObj[uuid].prototype = new ValObj();
        }

        return new ValObj[uuid]();
    }
};

ValObj.prototype.getCharVals = function () {
    return this.constructor[this.uuid].charVals;
};

ValObj.prototype.transToValObj = function (argInst) {
    var self = this,
        charVals,
        cmdExtraParams,
        param,
        extJudge;

    if (_.isObject(this.uuid)) {
        // loop uuid
        for (var i = 0; i < _.values(argInst).length; i += 1) {
            charVals = hciCharMeta[this.uuid['uuid' + i]];
            self['handle' + i] = {};

            _.forEach(charVals.params, function (param) {
                if (!argInst[_.keys(argInst)[i]].hasOwnProperty(param)) { throw new Error('The argument object has incorrect properties.'); }
                self['handle' + i][param] = argInst[_.keys(argInst)[i]][param];
            });

            if (charVals.extra) {
                if (argInst[_.keys(argInst)[i]].hasOwnProperty('Flags')) {
                    extJudge = function(i) { return ((argInst[_.keys(argInst)[i]].Flags & charVals.extra.flags[i]) === charVals.extra.result[i]); };
                } else if (argInst[_.keys(argInst)[i]].hasOwnProperty('Condition')) {
                    extJudge = function(i) { 
                        if (self.uuid['uuid' + i] === '0x290a' && argInst[_.keys(argInst)[i]].Condition === 0) return false;
                        else return (argInst[_.keys(argInst)[i]].Condition <= charVals.extra.result[i]); 
                    };
                } else if (argInst.hasOwnProperty('OpCode')) {
                    // TODO handle variable
                    extJudge = function(i) { return (argInst[_.keys(argInst)[i]].OpCode === charVals.extra.result[i]); };
                }

                for(var i = 0; i < _.size(charVals.extra.params); i += 1) {
                    if (extJudge(i)) {
                        param = charVals.extra.params[i];
                        if (!argInst[_.keys(argInst)[i]].hasOwnProperty(param)) { throw new Error('The argument object has incorrect properties.'); }
                        self['handle' + i][param] = argInst[_.keys(argInst)[i]][param];
                        
                        if (argInst.hasOwnProperty('Condition')) break;
                    }
                }
            }
        }
    } else {
        charVals = this.getCharVals();

        if (argInst instanceof ValObj[this.uuid]) { return argInst; }

        _.forEach(charVals.params, function (param) {
            if (!argInst.hasOwnProperty(param)) { throw new Error('The argument object has incorrect properties.'); }
            self[param] = argInst[param];
        });

        if (charVals.extra) {
            if (argInst.hasOwnProperty('Flags')) {
                extJudge = function(i) { return ((argInst.Flags & charVals.extra.flags[i]) === charVals.extra.result[i]); };
            } else if (argInst.hasOwnProperty('Condition')) {
                // handle 0x290a 0x290e
                extJudge = function(i) { 
                    if (self.uuid === '0x290a' && argInst.Condition === 0) return false;
                    else return (argInst.Condition <= charVals.extra.result[i]); };
            } else if (argInst.hasOwnProperty('OpCode')) {
                // TODO handle variable
                extJudge = function(i) { return (argInst.OpCode === charVals.extra.result[i]); };
            }

            for(var i = 0; i < _.size(charVals.extra.params); i += 1) {
                if (extJudge(i)) {
                    param = charVals.extra.params[i];
                    if (!argInst.hasOwnProperty(param)) { throw new Error('The argument object has incorrect properties.'); }
                    self[param] = argInst[param];
                    
                    if (argInst.hasOwnProperty('Condition')) break;
                }
            }
        }
    }   
    return this;
};

ValObj.prototype.getHciCharBuf = function (callback) {
    var self = this,
        dataBuf = Concentrate(),
        charVals;

    if (_.isObject(this.uuid)) {
        for (var i = 0; i < _.size(this.uuid); i += 1) {
            charVals = hciCharMeta[this.uuid['uuid' + i]];
            _.forEach(charVals.params, function (param, idx) {
                var paramVal = self['handle' + i][param],
                    paramType = charVals.types[idx];

                // checkType(paramVal, paramType, param);
                builder(dataBuf, paramVal, paramType);
            });

            if (charVals.extra) {
                if (this['handle' + i].hasOwnProperty('Flags') || this['handle' + i].hasOwnProperty('Condition') || this.hasOwnProperty('OpCode')) {
                    _.forEach(charVals.extra.params, function (param, idx) {
                        if (self['handle' + i].hasOwnProperty(param)) builder(dataBuf, self['handle' + i][param], charVals.extra.types[idx]);
                    });
                }
            }
        }
    } else {
        charVals = this.getCharVals();

        _.forEach(charVals.params, function (param, idx) {
            var paramVal = self[param],
                paramType = charVals.types[idx];

            // checkType(paramVal, paramType, param);
            builder(dataBuf, paramVal, paramType);
        });

        if (charVals.extra) {
            if (this.hasOwnProperty('Flags') || this.hasOwnProperty('Condition') || this.hasOwnProperty('OpCode')) {
                _.forEach(charVals.extra.params, function (param, idx) {
                    if (self.hasOwnProperty(param)) builder(dataBuf, self[param], charVals.extra.types[idx]);
                });
            }
        }    
    }
 
    return dataBuf.result();
};

function builder(dataBuf, paramVal, paramType) {
    var tmpBuf,
        result,
        sgn,
        mantissa,
        exponent,
        smantissa,
        rmantissa,
        mdiff,
        int_mantissa;

    switch (paramType) {
        case 'int8' :
        case 'int16' :
        case 'int32' :
        case 'uint8':
        case 'uint16':
        case 'uint32':
            dataBuf = dataBuf[paramType](paramVal);
            break;
        case 'uint24':
            tmpBuf = paramVal & 0xFFFF; 
            dataBuf = dataBuf.uint16(tmpBuf);
            tmpBuf = paramVal >> 16;
            dataBuf = dataBuf.uint8(tmpBuf);
            break;
        case 'int24':
            tmpBuf = paramVal & 0xFFFF; 
            dataBuf = dataBuf.uint16(tmpBuf);
            tmpBuf = paramVal >> 16 & 0xFF;
            dataBuf = dataBuf.uint8(tmpBuf);
            break;
        case 'string':
            dataBuf = dataBuf.string(paramVal, "utf8");
            break;
        case 'uuid':
        case 'addr3':
        case 'addr5':
        case 'addr6':
            paramVal = str2Buf(paramVal);
            dataBuf = dataBuf.buffer(paramVal);
            break;
        case 'boolean':
            dataBuf = dataBuf.uint8(paramVal);
            break;
        case 'nibble': 
            nibbleBuf.push(paramVal);
            if (nibbleBuf.length === 2) {
                dataBuf = dataBuf.uint8(nibbleBuf[0] + (nibbleBuf[1] << 4));
                nibbleBuf = [];
            }
            break;
        case 'sfloat':
            result = 0x07FF;
            sgn = paramVal > 0 ? +1 : -1;
            mantissa = Math.abs(paramVal);
            exponent = 0;

            if (isNaN(paramVal)) {
                dataBuf = dataBuf.uint16(result);
                break;
            } else if (paramVal > 20450000000.0) {
                result = 0x07FE;
                dataBuf = dataBuf.uint16(result);
                break;
            } else if (paramVal < -20450000000.0) {
                result = 0x0802;
                dataBuf = dataBuf.uint16(result);
                break;
            } else if (paramVal >= -1e-8 && paramVal <= 1e-8) {
                result = 0;
                dataBuf = dataBuf.uint16(result);
                break;
            }

            // scale up if number is too big
            while (mantissa > 0x07FD) {
                mantissa /= 10.0;
                ++exponent;
                if (exponent > 7) {
                    // argh, should not happen
                    if (sgn > 0) {
                        result = 0x07FE;
                    } else {
                        result = 0x0802;
                    }
                    dataBuf = dataBuf.uint16(result);
                    break;
                }
            }

            // scale down if number is too small
            while (mantissa < 1) {
                mantissa *= 10;
                --exponent;
                if (exponent < -8) {
                    // argh, should not happen
                    result = 0;
                    dataBuf = dataBuf.uint16(result);
                    break;
                }
            }

            smantissa = Math.round(mantissa * 10000);
            rmantissa = Math.round(mantissa) * 10000;
            mdiff = Math.abs(smantissa - rmantissa);

            while (mdiff > 0.5 && exponent > -8 && (mantissa * 10) <= 0x07FD) {
                mantissa *= 10;
                --exponent;
                smantissa = Math.round(mantissa * 10000);
                rmantissa = Math.round(mantissa) * 10000;
                mdiff = Math.abs(smantissa - rmantissa);
            }
            int_mantissa = parseInt(Math.round(sgn * mantissa));
            result = ((exponent & 0xF) << 12) | (int_mantissa & 0xFFF);
            dataBuf = dataBuf.uint16(result);
            break;
        case 'float':
            result = 0x007FFFFF;
            sgn = paramVal > 0 ? +1 : -1;
            mantissa = Math.abs(paramVal);
            exponent = 0;

            if (isNaN(paramVal)) {
                dataBuf = dataBuf.uint32(result);
                break;
            } else if (paramVal > 8.388604999999999e+133) {
                result = 0x007FFFFE;
                dataBuf = dataBuf.uint32(result);
                break;
            } else if (paramVal < -(8.388604999999999e+133)) {
                result = 0x00800002;
                dataBuf = dataBuf.uint32(result);
                break;
            } else if (paramVal >= -(1e-128) && paramVal <= 1e-128) {
                result = 0;
                dataBuf = dataBuf.uint32(result);
                break;
            }

            // scale up if number is too big
            while (mantissa > 0x007FFFFD) {
                mantissa /= 10.0;
                ++exponent;
                if (exponent > 127) {
                    // argh, should not happen
                    if (sgn > 0) {
                        result = 0x007FFFFE;
                    } else {
                        result = 0x00800002;
                    }
                    dataBuf = dataBuf.uint32(result);
                    break;
                }
            }

            // scale down if number is too small
            while (mantissa < 1) {
                mantissa *= 10;
                --exponent;
                if (exponent < -128) {
                    // argh, should not happen
                    result = 0;
                    dataBuf = dataBuf.uint32(result);
                    break;
                }
            }

            // scale down if number needs more precision
            smantissa = Math.round(mantissa * 10000000);
            rmantissa = Math.round(mantissa) * 10000000;
            mdiff = Math.abs(smantissa - rmantissa);
            while (mdiff > 0.5 && exponent > -128 && (mantissa * 10) <= 0x007FFFFD) {
                mantissa *= 10;
                --exponent;
                smantissa = Math.round(mantissa * 10000000);
                rmantissa = Math.round(mantissa) * 10000000;
                mdiff = Math.abs(smantissa - rmantissa);
            }

            int_mantissa = parseInt(Math.round(sgn * mantissa));
            result = ((exponent & 0xFF) << 24) | (int_mantissa & 0xFFFFFF);
            dataBuf = dataBuf.int32(result);
            break;
        default:
            throw new Error("Unknown Data Type");
    }

    return dataBuf;
}
/*************************************************************************************************/
/*** Private Functions                                                                         ***/
/*************************************************************************************************/
function checkType(data, type, param) {
    var typeObj = {
        uint8: 255,
        uint16be: 65535,
        uint16le: 65535,
        uint32le: 4294967295,
        buffer: 255,
        buffer8: 8,
        buffer16: 16
    };

    switch (type) {
        case 'uint8':
        case 'uint16':
        case 'uint32':
            if (!(_.isNumber(data)) || (data < 0) || (data > typeObj[type])) { 
                throw new Error(param + ' must be an integer from 0 to ' + typeObj[type] + '.'); 
            }
            break;

        case 'addr':
        case 'string':
            if (!_.isString(data)) {
                throw new Error(param + ' must be a string.');
            }
            break;

        default:
            throw new Error("Unknown Data Type");
    }
}

function str2Buf (str) {
    var bufLen,
        val,
        chunk,
        tmpBuf;

    if (_.startsWith(str, '0x')) { str = str.slice(2); }
    bufLen = str.length / 2;
    tmpBuf = (new Buffer(bufLen)).fill(0);
    for (var i = 0; i < bufLen; i += 1) {
        chunk = str.substring(0, 2);
        val = _.parseInt(chunk, 16);
        str = str.slice(2);
        tmpBuf.writeUInt8(val, (bufLen-i-1));
    }

    return tmpBuf;
}

module.exports = hciCharBuilder;