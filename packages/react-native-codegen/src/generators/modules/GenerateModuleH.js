/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';

import type {
  SchemaType,
  FunctionTypeAnnotationParamTypeAnnotation,
  FunctionTypeAnnotationReturn,
  TypeAliasTypeAnnotation,
  ObjectTypeAliasTypeShape,
} from '../../CodegenSchema';

const {getTypeAliasTypeAnnotation} = require('./ObjCppUtils/Utils');

type FilesOutput = Map<string, string>;

const moduleTemplate = `
class JSI_EXPORT Native::_MODULE_NAME_::CxxSpecJSI : public TurboModule {
protected:
  Native::_MODULE_NAME_::CxxSpecJSI(std::shared_ptr<CallInvoker> jsInvoker);

public:
::_MODULE_PROPERTIES_::

};`;

const template = `
/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <ReactCommon/TurboModule.h>

namespace facebook {
namespace react {
::_MODULES_::

} // namespace react
} // namespace facebook
`;

function translatePrimitiveJSTypeToCpp(
  typeAnnotation:
    | FunctionTypeAnnotationParamTypeAnnotation
    | FunctionTypeAnnotationReturn
    | TypeAliasTypeAnnotation,
  createErrorMessage: (typeName: string) => string,
  aliases: $ReadOnly<{[aliasName: string]: ObjectTypeAliasTypeShape, ...}>,
) {
  const realTypeAnnotation =
    typeAnnotation.type === 'TypeAliasTypeAnnotation'
      ? getTypeAliasTypeAnnotation(typeAnnotation.name, aliases)
      : typeAnnotation;
  switch (realTypeAnnotation.type) {
    case 'ReservedFunctionValueTypeAnnotation':
      switch (realTypeAnnotation.name) {
        case 'RootTag':
          return 'double';
        default:
          (realTypeAnnotation.name: empty);
          throw new Error(createErrorMessage(realTypeAnnotation.name));
      }
    case 'VoidTypeAnnotation':
      return 'void';
    case 'StringTypeAnnotation':
      return 'jsi::String';
    case 'NumberTypeAnnotation':
    case 'FloatTypeAnnotation':
      return 'double';
    case 'Int32TypeAnnotation':
      return 'int';
    case 'BooleanTypeAnnotation':
      return 'bool';
    case 'GenericObjectTypeAnnotation':
    case 'ObjectTypeAnnotation':
      return 'jsi::Object';
    case 'ArrayTypeAnnotation':
      return 'jsi::Array';
    case 'FunctionTypeAnnotation':
      return 'jsi::Function';
    case 'GenericPromiseTypeAnnotation':
      return 'jsi::Value';
    default:
      // TODO (T65847278): Figure out why this does not work.
      // (type: empty);
      throw new Error(createErrorMessage(realTypeAnnotation.type));
  }
}

const propertyTemplate =
  'virtual ::_RETURN_VALUE_:: ::_PROPERTY_NAME_::(jsi::Runtime &rt::_ARGS_::) = 0;';

module.exports = {
  generate(
    libraryName: string,
    schema: SchemaType,
    moduleSpecName: string,
  ): FilesOutput {
    const nativeModules = Object.keys(schema.modules)
      .map(moduleName => {
        const modules = schema.modules[moduleName].nativeModules;
        if (modules == null) {
          return null;
        }

        return modules;
      })
      .filter(Boolean)
      .reduce((acc, components) => Object.assign(acc, components), {});

    const modules = Object.keys(nativeModules)
      .map(name => {
        const {aliases, properties} = nativeModules[name];
        const traversedProperties = properties
          .map(prop => {
            const traversedArgs = prop.typeAnnotation.params
              .map(param => {
                const translatedParam = translatePrimitiveJSTypeToCpp(
                  param.typeAnnotation,
                  typeName =>
                    `Unsupported type for param "${param.name}" in ${prop.name}. Found: ${typeName}`,
                  aliases,
                );
                const isObject = translatedParam.startsWith('jsi::');
                return (
                  (isObject
                    ? 'const ' + translatedParam + ' &'
                    : translatedParam + ' ') + param.name
                );
              })
              .join(', ');
            return propertyTemplate
              .replace('::_PROPERTY_NAME_::', prop.name)
              .replace(
                '::_RETURN_VALUE_::',
                translatePrimitiveJSTypeToCpp(
                  prop.typeAnnotation.returnTypeAnnotation,
                  typeName =>
                    `Unsupported return type for ${prop.name}. Found: ${typeName}`,
                  aliases,
                ),
              )
              .replace(
                '::_ARGS_::',
                traversedArgs === '' ? '' : ', ' + traversedArgs,
              );
          })
          .join('\n');
        return moduleTemplate
          .replace(/::_MODULE_PROPERTIES_::/g, traversedProperties)
          .replace(/::_MODULE_NAME_::/g, name)
          .replace('::_PROPERTIES_MAP_::', '');
      })
      .join('\n');

    const fileName = 'NativeModules.h';
    const replacedTemplate = template.replace(/::_MODULES_::/g, modules);

    return new Map([[fileName, replacedTemplate]]);
  },
};
