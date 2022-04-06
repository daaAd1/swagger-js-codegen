var _ = require('lodash');
var ts = require('../typescript');
var normalizeName = require('../utilities').Utilities.normalizeName;
var getPathToMethodName = require('../utilities').Utilities.getPathToMethodName;

var getViewForSwagger3 = function (opts, type) {
  var swagger = opts.swagger;
  var methods = [];
  var authorizedMethods = [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'COPY',
    'HEAD',
    'OPTIONS',
    'LINK',
    'UNLIK',
    'PURGE',
    'LOCK',
    'UNLOCK',
    'PROPFIND',
  ];

  const securitySchemes =
    swagger.components && swagger.components.securitySchemes
      ? swagger.components.securitySchemes
      : undefined;

  var data = {
    isNode: type === 'node' || type === 'javascript',
    isES6: opts.isES6 || type === 'javascript',
    description: swagger.info.description,
    isSecure: typeof securitySchemes !== 'undefined',
    className: opts.className,
    domain:
      swagger.schemes &&
      swagger.schemes.length > 0 &&
      swagger.host &&
      swagger.basePath
        ? swagger.schemes[0] +
          '://' +
          swagger.host +
          swagger.basePath.replace(/\/+$/g, '')
        : '',
    methods: [],
    definitions: [],
  };

  _.forEach(swagger.paths, function (api, path) {
    var globalParams = [];
    /**
     * @param {Object} op - meta data for the request
     * @param {string} m - HTTP method name - eg: 'get', 'post', 'put', 'delete'
     */
    _.forEach(api, function (op, m) {
      if (m.toLowerCase() === 'parameters') {
        globalParams = op;
      }
    });
    _.forEach(api, function (op, m) {
      var M = m.toUpperCase();
      if (M === '' || authorizedMethods.indexOf(M) === -1) {
        return;
      }
      const secureDefinitions = [];
      if (
        typeof securitySchemes !== 'undefined' ||
        typeof op.security !== 'undefined'
      ) {
        const mergedSecurity = _.flatten(
          _.merge([], swagger.security, op.security).map(function (security) {
            return Object.keys(security);
          }),
        );
        if (securitySchemes) {
          for (const sk in securitySchemes) {
            if (mergedSecurity.includes(sk)) {
              secureDefinitions.push(securitySchemes[sk]);
            }
          }
        }
      }
      var methodName = op.operationId
        ? normalizeName(op.operationId)
        : getPathToMethodName(opts, m, path);
      // Make sure the method name is unique
      if (methods.indexOf(methodName) !== -1) {
        var i = 1;
        while (true) {
          if (methods.indexOf(methodName + '_' + i) !== -1) {
            i++;
          } else {
            methodName = methodName + '_' + i;
            break;
          }
        }
      }

      methods.push(methodName);

      var method = {
        path: path,
        className: opts.className,
        methodName: methodName,
        method: M,
        isGET: M === 'GET',
        isPOST: M === 'POST',
        isFormMethod: false,
        summary: op.description || op.summary,
        externalDocs: op.externalDocs,
        isSecure: swagger.security !== undefined || op.security !== undefined,
        isSecureToken: !!secureDefinitions.find(sd => sd.type === 'oauth2') || !!(sd.type === 'http' && sd.scheme === 'bearer'),
        isSecureApiKey: !!secureDefinitions.find(sd => sd.type === 'apiKey'),
        isSecureBasic: !!secureDefinitions.find(sd => sd.type === 'basic'),
        parameters: [],
        headers: [],
      };
      if (method.isSecure && method.isSecureToken) {
        data.isSecureToken = method.isSecureToken;
      }
      if (method.isSecure && method.isSecureApiKey) {
        data.isSecureApiKey = method.isSecureApiKey;
        data.apiKeyHeaderName = (
          Object.values(swagger.components.securitySchemes).find(
            (i) => i.type === 'apiKey',
          ) || { name: 'X-API-Key' }
        ).name;
      }
      if (method.isSecure && method.isSecureBasic) {
        data.isSecureBasic = method.isSecureBasic;
      }

      // @TODO rewrite for OA3 - need an example for parameters
      var params = [];
      if (_.isArray(op.parameters)) {
        params = op.parameters;
      }
      params = params.concat(globalParams);

      var hasBody = false;
      var hasExtraHeader = false;

      if (_.isObject(op.requestBody)) {
        hasBody = true;
        const headerKeys = Object.keys(op.requestBody.content);
        if (headerKeys.length > 0) {
          // selecting only first found header (not supporting multiple content types in request)
          const firstHeaderContentType = headerKeys[0];
          const newParam = {
            name: opts.requestBodyParameterName || 'body',
            description: op.requestBody.description,
            ...op.requestBody.content[firstHeaderContentType],
          };
          if (firstHeaderContentType === 'multipart/form-data') {
            newParam.isFormParameter = true;
          } else if (firstHeaderContentType === 'application/json') {
            newParam.isBodyParameter = true;
          } else if (
            firstHeaderContentType === 'application/x-www-form-urlencoded'
          ) {
            hasBody = false;
          }
          params.push(newParam);

          method.headers.push({
            name: 'Content-Type',
            value: firstHeaderContentType,
          });
          if (firstHeaderContentType === 'multipart/form-data') {
            method.isFormMethod = true;
          }
        }
      }

      var hasAnyRequired = false;
      _.forEach(params, function (parameter) {
        //Ignore parameters which contain the x-exclude-from-bindings extension
        if (parameter['x-exclude-from-bindings'] === true) {
          return;
        }

        // Ignore headers which are injected by proxies & app servers
        // eg: https://cloud.google.com/appengine/docs/go/requests#Go_Request_headers
        if (parameter['x-proxy-header'] && !data.isNode) {
          return;
        }
        if (_.isString(parameter.$ref)) {
          var segments = parameter.$ref.split('/');
          parameter =
            swagger.components.parameters[
              segments.length === 1 ? segments[0] : segments[3]
            ];
        }
        parameter.camelCaseName = _.camelCase(parameter.name);
        if (parameter.enum && parameter.enum.length === 1) {
          parameter.isSingleton = true;
          parameter.singleton = parameter.enum[0];
        }
        if (parameter.in === 'path') {
          parameter.isPathParameter = true;
        } else if (parameter.in === 'query') {
          if (parameter['x-name-pattern']) {
            parameter.isPatternType = true;
          }
          parameter.pattern = parameter['x-name-pattern'];
          parameter.isQueryParameter = true;
        } else if (parameter.in === 'header') {
          parameter.isHeaderParameter = true;
          hasExtraHeader = true;
        } else if (parameter.in === 'formData') {
          parameter.isFormParameter = true;
        }
        if (parameter.style === 'pipeDelimited') {
          parameter.transformOperation = 'joinUsingPipes';
        }
        parameter.tsType = ts.convertType(parameter, swagger);
        parameter.default =
          parameter.schema && parameter.schema.default
            ? parameter.schema.default
            : undefined;

        parameter.defaultSerialized = JSON.stringify(parameter.default);

        parameter.cardinality = parameter.required ? '' : '?';

        if (parameter.required && parameter.in !== 'path') {
          hasAnyRequired = true;
        }
        method.parameters.push(parameter);
      });

      method.defaultParam = hasAnyRequired ? '' : ' = {}';
      method.hasExtraHeader = hasExtraHeader;
      method.hasBody = hasBody;
      method.responses = op.responses;
      method.successResponses = [];
      const responseHeaders = {};
      _.forEach(method.responses, (response, statusCode) => {
        const content = response.content;
        _.forEach(content, (schema, contentType) => {
          responseHeaders[contentType] = null;
          if (contentType === 'application/json') {
            if (statusCode === '200' || statusCode === '201') {
              method.successResponses.push({
                tsType: ts.convertType(schema, swagger),
              });
            }
          } else {
            throw new Error(
              'Content type other than application/json not implemented, yet.',
            );
          }
        });
      });
      Object.keys(responseHeaders).forEach((contentType) => {
        method.headers.push({
          name: 'Accept',
          value: contentType,
        });
      });
      if (method.successResponses.length > 0) {
        method.successResponses[method.successResponses.length - 1].last = true;
      }
      data.methods.push(method);
    });
  });

  const definitions =
    swagger.components && swagger.components.schemas
      ? swagger.components.schemas
      : [];

  _.forEach(definitions, function (definition, name) {
    data.definitions.push({
      name: name,
      description: definition.description,
      tsType: ts.convertType(definition, swagger),
    });
  });

  return data;
};

exports.getViewForSwagger3 = getViewForSwagger3;
