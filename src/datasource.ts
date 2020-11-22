import {
  //MetricFindValue,
  DataSourceInstanceSettings,
  DataQueryRequest,
  //ScopedVar,
  TimeRange,
  DataFrame,
  MutableDataFrame,
  FieldType,
  CircularDataFrame,
  //AnnotationQueryRequest,
  //AnnotationEvent,
  //LoadingState,
  //ScopedVars,
} from '@grafana/data';
import { map } from 'lodash';
import { getBackendSrv, BackendSrv, getTemplateSrv, TemplateSrv, DataSourceWithBackend } from '@grafana/runtime';
//import { ResponseParser /*, DatabaseItem*/ } from './response_parser';
import {
  AdxDataSourceOptions,
  KustoQuery,
  AdxSchema,
  AdxColumnSchema,
  defaultQuery,
  QueryExpression,
  EditorMode,
  AutoCompleteQuery,
} from './types';
//import { getAnnotationsFromFrame } from './common/annotationsFromFrame';
import interpolateKustoQuery from './query_builder';
//import { firstStringFieldToMetricFindValue } from 'common/responseHelpers';
//import { QueryEditorPropertyExpression } from 'editor/expressions';
import { QueryEditorOperator } from 'editor/types';
import { cache } from 'schema/cache';
import { KustoExpressionParser } from 'KustoExpressionParser';
import { Observable, merge } from 'rxjs';
import defaults from 'lodash/defaults';

export class AdxDataSource extends DataSourceWithBackend<KustoQuery, AdxDataSourceOptions> {
  private backendSrv: BackendSrv;
  private templateSrv: TemplateSrv;
  baseUrl: string;
  wsUrl: string;
  //private defaultOrFirstDatabase: string;
  private url?: string;
  private expressionParser: KustoExpressionParser;
  private defaultEditorMode: EditorMode;
  connMap: any = {};
  frameRefMap: any = {}; // Panel ID, data frame map. Holds all data frames across panels
  //cleanUpMap: any = {}; // panel ID, cleanup status map
  cleanUpThresholdMap: any = {}; // panel ID, last timestamp cleaned up
  panelDataStateMap: any = {}; // panel ID, data state (dataFound/headerFound) map used to periodically emit data
  dataThreadStateMap: any = {}; // panel ID, data state map
  panelQuerySubscriptionMap: any = {}; // panel ID, query, subscription object map

  constructor(instanceSettings: DataSourceInstanceSettings<AdxDataSourceOptions>) {
    super(instanceSettings);

    this.backendSrv = getBackendSrv();
    this.templateSrv = getTemplateSrv();
    this.baseUrl = instanceSettings.url || ''; //'/azuredataexplorer';
    this.wsUrl = instanceSettings.jsonData.connUrl || ''; //'ws://localhost:5001';
    //this.defaultOrFirstDatabase = instanceSettings.jsonData.defaultDatabase;
    this.url = ''; // instanceSettings.url;
    this.expressionParser = new KustoExpressionParser(this.templateSrv);
    this.defaultEditorMode = EditorMode.Visual;
    this.parseExpression = this.parseExpression.bind(this);
    this.autoCompleteQuery = this.autoCompleteQuery.bind(this);
  }

  query(options: DataQueryRequest<KustoQuery>): any {
    const panelId = options.panelId || 0;
    this.cleanUpThresholdMap = {};
    const streams = options.targets.map(target => {
      const query = defaults(target, defaultQuery);

      if (!query.query) {
        return Promise.resolve({
          data: [],
        });
      }
      return Observable.create((s: any) => {
        const me = this;
        //this.queryMap[panelId] = query;
        this.panelQuerySubscriptionMap[panelId] = {};
        this.panelQuerySubscriptionMap[panelId]['query'] = query;
        this.panelQuerySubscriptionMap[panelId]['subscription'] = s;
        this.panelQuerySubscriptionMap[panelId]['refId'] = query.refId;
        const { range, rangeRaw } = options;

        const relativeTime = typeof rangeRaw!.to === 'string';
        const queryStr = query.query;
        const q = {
          kusto: queryStr,
          from: range!.from.valueOf(),
          to: range!.to.valueOf(),
        };

        if (this.connMap[panelId]) {
          this.connMap[panelId].close();
        }

        const wsConn = new WebSocket(this.wsUrl);
        this.connMap[panelId] = wsConn;

        if (!this.frameRefMap[panelId]) {
          this.frameRefMap[panelId] = {};
        }

        // if (query.cleanupData === 'true' && !this.cleanUpMap[panelId]) {
        //   this.cleanUpMap[panelId] = true;
        //   this.checkAndClean(panelId);
        // }

        if (!this.dataThreadStateMap[panelId]) {
          this.dataThreadStateMap[panelId] = true;
          this.checkAndEmit(panelId);
        }

        this.frameRefMap[panelId]['frameRef'] = {};
        this.frameRefMap[panelId]['subscription'] = s;
        this.frameRefMap[panelId]['refId'] = query.refId;
        this.frameRefMap[panelId]['fromTime'] = rangeRaw!.from;

        const headerFields: any = {};
        this.setWsConn(this.connMap[panelId], panelId, q, query, headerFields, s, relativeTime);

        return () => {
          if (me.connMap) {
            Object.keys(me.connMap).forEach(panelId => {
              if (me.connMap[panelId] && me.connMap[panelId].readyState === WebSocket.OPEN) {
                console.log('Closing connection for' + panelId);
                me.connMap[panelId].close();
              }
            });
          }
        };
      });
    });

    return merge(...streams);
  }

  // Set websocket connection
  setWsConn(wsConn: any, panelId: any, q: any, queryObj: KustoQuery, headerFields: any, s: any, relativeTime: boolean) {
    const me = this;
    const columnSeq: any = {};

    if (wsConn.readyState === WebSocket.OPEN) {
      wsConn.send(
        JSON.stringify({
          panelId: panelId,
          query: q,
          type: 'query',
          database: queryObj.database,
          pivot: JSON.parse(queryObj.pivot),
          realTime: JSON.parse(queryObj.realTime) && relativeTime,
        })
      );
      return;
    } else if (wsConn.readyState === WebSocket.CLOSED) {
      wsConn = new WebSocket(this.wsUrl);
    }

    wsConn.onopen = function() {
      // Send panel query to server
      wsConn.send(
        JSON.stringify({
          panelId: panelId,
          query: q,
          type: 'query',
          database: queryObj.database,
          pivot: JSON.parse(queryObj.pivot),
          realTime: JSON.parse(queryObj.realTime) && relativeTime,
        })
      );
      console.log('WebSocket Client Connected for panel: ' + panelId);
    };

    wsConn.onmessage = function(m: any) {
      if (m.error) {
        console.log(m.error);
        s.next({ data: [], error: { message: m.error } });
      } else {
        //console.log(new Date() + " Still receiving");
        const data = JSON.parse(m.data);
        if (data.error) {
          s.next({
            data: [],
            error: { message: data.error.code || 'Erorr in connection' },
          });
        } else {
          // Add data to dataframe
          me.updateData(data.data, queryObj, s, headerFields, columnSeq, me.frameRefMap[panelId]['frameRef'], panelId);
        }
      }
    };

    wsConn.onerror = function(e: any) {
      if (e.type === 'error') {
        s.next({
          data: [],
          error: { message: 'Error in web socket connection' },
        });
      } else {
        s.next({ data: [], error: { message: 'Unknown error in connection' } });
      }
      me.connMap[panelId] = undefined;
    };

    wsConn.onclose = function() {};
  }

  // Parse and Add data to dataframe
  updateData(
    data: any,
    query: KustoQuery,
    subscription: any,
    headerFields: any,
    columnSeq: any,
    frameRef: any,
    panelId: string
  ) {
    try {
      const resp = data; //this.parseResponse(data, partialChunk);
      if (!resp || resp.length === 0) {
        // No data case
        // subscription.next({
        //   data: []
        // });
        return;
      }

      this.panelDataStateMap[panelId] = {};
      this.panelDataStateMap[panelId]['dataFound'] = false;
      //this.panelDataStateMap[panelId]["headerFound"] = false;
      //let dataFound = false;
      //let headerFound = false;
      let keyColumns: string[];
      resp.forEach((rowObj: any, index: number) => {
        const rowResultData: any = {};

        // Create frame if not created already and add columns
        if (rowObj['__header__']) {
          if (rowObj['__key__']) {
            // Save the key column names
            keyColumns = rowObj['__key__'];
          }

          let found = false;
          rowObj['__header__'].forEach((ele: any) => {
            if (!headerFields[ele.name]) {
              headerFields[ele.name] = ele.type; // Save type of the header field
              found = true;
            }
          });

          if (!found) {
            // All columns already added in the dataframe in previous passes
            return;
          }

          let visualType = 'metric';
          const headers = Object.keys(headerFields);
          if (
            headers.length === 2 &&
            ((['datetime', 'timestamp'].includes(headerFields[headers[0]]) && headerFields[headers[1]] === 'string') ||
              (['datetime', 'timestamp'].includes(headerFields[headers[1]]) && headerFields[headers[0]] === 'string'))
          ) {
            visualType = 'logs';
          }

          const isLogData: boolean = Object.values(headerFields).includes('string');
          const dateTimeField: any = Object.keys(headerFields).find(k => headerFields[k] === 'datetime');

          Object.keys(headerFields).forEach((f: string, index: number) => {
            // In case of single dataframe create one frame for all columns named default
            if (query.dimention === 'single') {
              let frame = frameRef['default'];
              if (!frame) {
                frame = this.createDataFrame(query, visualType, isLogData, query.logLimit);
                frameRef['default'] = frame;
              }

              this.addFieldsToFrame(frame, f, headerFields[f]);
            } else {
              // In case of multi frame create one frame for one column
              if (headerFields[f] !== 'datetime') {
                const frame = this.createDataFrame(query, visualType, isLogData, query.logLimit);
                this.addFieldsToFrame(frame, f, headerFields[f]);

                if (dateTimeField) {
                  this.addFieldsToFrame(frame, dateTimeField, 'datetime');
                }

                frameRef[f] = frame;
              }
            }
            columnSeq[index] = f;
          });
        } else if (rowObj['@type'] && rowObj['@type'] === 'statement_error') {
          // Error case
          subscription.next({
            data: [],
            error: { message: rowObj['message'] },
          });
          return;
        } else {
          // Data case
          //const columns: any[] = rowObj["row"]["columns"];

          // if (
          //   this.isOutsideTimeFrame(columns[0], panelId, rowObj["row"], toDate)
          // ) {
          //   return;
          // }

          Object.keys(rowObj).forEach(key => {
            if (!headerFields[key]) {
              return;
            }

            rowResultData[key] = rowObj[key];
          });
        }

        if (Object.keys(rowResultData).length > 0) {
          this.panelDataStateMap[panelId]['dataFound'] = true;
          //dataFound = true;
          if (query.dimention === 'single') {
            //frameRef.default.add(rowResultData);
            this.addUpdateValueToFrame(frameRef.default, rowResultData, columnSeq, headerFields, keyColumns);
          } else {
            Object.keys(rowResultData).forEach((key: any, i: number) => {
              if (headerFields[key] === 'datetime') {
                return;
              }

              const d = {
                [columnSeq[0]]: rowResultData[columnSeq[0]],
                [key]: rowResultData[key],
              };
              this.addUpdateValueToFrame(frameRef[key], d, columnSeq, headerFields, keyColumns);
            });
          }
        }
      });

      // if (this.panelDataStateMap[panelId]["dataFound"]) {
      //   this.emitToPanel(subscription, frameRef, query.refId);
      // } else if (headerFound) {
      //   setTimeout(() => {
      //     this.emitToPanel(subscription, frameRef, query.refId);
      //   }, 30000);
      // }

      return;
    } catch (ex) {
      console.log('Exception in fetching the response. skipping the results for this batch. ' + ex);
      subscription.next({
        data: [],
        error: { message: 'Error in parsing the response' },
      });
      return;
    }
  }

  // Check if the received data point is outside the selected time frame with some buffer
  isOutsideTimeFrame(_timeVal: any, panelId: any, data: any, _toDate?: Date): boolean {
    let toDate = new Date();
    if (_toDate) {
      toDate = new Date(_toDate);
    }
    const bufferredMaxDate = new Date(toDate);
    bufferredMaxDate.setSeconds(toDate.getSeconds() + 300);

    const outOfRange = new Date(_timeVal) > bufferredMaxDate;

    if (outOfRange) {
      console.log(
        'Data discarded for ' +
          'Panel: ' +
          panelId +
          ' Data= ' +
          data.columns.toString() +
          ' Current time (with buffer): ' +
          bufferredMaxDate.valueOf()
      );
    }
    return outOfRange;
  }

  // Add or update the value of a cell in dataframe
  addUpdateValueToFrame(
    frame: MutableDataFrame,
    rowResultData: any,
    columnSeq: any,
    headerFields: any,
    keyColumns: string[]
  ) {
    const uniqueFields = keyColumns; //["__key__"];
    const frameTimeStamps = frame && frame.values[columnSeq[0]] ? frame.values[columnSeq[0]].toArray() : [];

    let updateAt = -1;
    if (!uniqueFields) {
      // No unique fields, append the record
      updateAt = -1;
    } else if (uniqueFields.length === 0) {
      // Empty unique fields, update the 0th record
      updateAt = 0;
    } else {
      // Check for uniqueness and add or update the value
      for (let i = 0; i < frameTimeStamps.length; i++) {
        // Find index from frame where all unique columns have same data
        let found = false;
        for (let j = 0; j < uniqueFields.length; j++) {
          if (rowResultData[uniqueFields[j]] === frame.values[uniqueFields[j]].get(i)) {
            found = true;
          } else {
            found = false;
            break;
          }
        }
        if (found) {
          updateAt = i;
          break;
        }
      }
    }

    //let unique = true;
    if (updateAt >= 0) {
      // Duplicate record already present in the frame, update it
      frame.set(updateAt, rowResultData);
    } else {
      // New record, find the position in the frame and insert the record
      if (
        ['datetime', 'timespan'].includes(headerFields[columnSeq[0]]) &&
        rowResultData[columnSeq[0]] < frameTimeStamps[frameTimeStamps.length - 1]
      ) {
        //old data point, received late
        let insertAt = frameTimeStamps.findIndex((v: any) => rowResultData[columnSeq[0]] < v);

        const nextPoints: any[] = [rowResultData];
        for (let i = insertAt; i < frameTimeStamps.length; i++) {
          nextPoints.push(frame.get(i));
        }

        let i = 0;
        for (; i < nextPoints.length - 1; i++) {
          frame.set(insertAt++, nextPoints[i]);
        }
        frame.add(nextPoints[i]);
      } else {
        frame.add(rowResultData);
      }
    }
  }

  // Emit the data to Grafana panel
  emitToPanel(subscription: any, frameRef: any, refId: any) {
    subscription.next({ data: [] });
    subscription.next({
      data: Object.values(frameRef),
      key: refId,
    });
  }

  // Periodically emit the data if new data is available
  checkAndEmit(panelId: any) {
    const frameRef = this.frameRefMap[panelId]['frameRef'];
    const subscription = this.panelQuerySubscriptionMap[panelId]['subscription'];
    const refId = this.panelQuerySubscriptionMap[panelId]['refId'];

    if (this.panelDataStateMap[panelId] && this.panelDataStateMap[panelId]['dataFound']) {
      this.panelDataStateMap[panelId]['dataFound'] = false;
      this.emitToPanel(subscription, frameRef, refId);
    }

    setTimeout(() => this.checkAndEmit(panelId), 1000);
  }

  getQueryString(query: KustoQuery, rowTimeStr: string, rowEndTime?: string) {
    let queryText = query.query;
    let clause = " where ROWTIME >= '" + rowTimeStr + "'" + (rowEndTime ? " AND ROWTIME < '" + rowEndTime + "'" : '');
    if (queryText.match(/ where /i)) {
      queryText = queryText.replace(/ where /i, clause + ' AND ');
    } else if (queryText.match(/ WINDOW\s+TUMBLING /i)) {
      const matches: any[] | null = queryText.match(/ WINDOW\s+TUMBLING (\(.*?\))/i);
      if (matches) {
        queryText = queryText.replace(matches[1], matches[1] + clause);
      }
    } else {
      const matches: any[] | null = queryText.match(/ from (.*?) /i);
      if (matches && matches[1]) {
        queryText = queryText.replace(matches[1], matches[1] + clause);
      }
    }

    if (!queryText.endsWith(';')) {
      queryText += ';';
    }

    const endTime = rowEndTime ? new Date(rowEndTime!.replace('+0000', '')).valueOf() : new Date().valueOf();
    const diff = Math.abs(endTime - new Date(rowTimeStr.replace('+0000', '')).valueOf()) / 1000;

    //queryText = queryText.replace('_RANGE_', 1800);
    queryText = queryText.replace('_RANGE_', diff.toFixed(0));

    return queryText;
  }

  createDataFrame(query: KustoQuery, visualType: string, isLogData: boolean, capacity: number): MutableDataFrame {
    const frame = isLogData ? new CircularDataFrame({ append: 'tail', capacity: +capacity }) : new MutableDataFrame();
    //   {
    //   append: 'tail',
    //   capacity: query.frameSize,
    // }
    frame.refId = query.refId;

    if (visualType === 'logs') {
      frame.meta = {
        preferredVisualisationType: 'logs',
      };
    }

    return frame;
  }

  addFieldsToFrame(frame: MutableDataFrame, columnName: string, dataType: string) {
    if (['string', 'guid'].includes(dataType)) {
      frame.addField({ name: columnName, type: FieldType.string });
    } else if ('datetime' === dataType) {
      frame.addField({ name: columnName, type: FieldType.time });
    } else {
      frame.addField({ name: columnName, type: FieldType.number });
    }
  }

  async getSchema(): Promise<AdxSchema> {
    return cache(`${this.id}.schema.overview`, () => {
      const url = `${this.baseUrl}/fetchschema`;

      return this.doRequest(url)
        .then(resp => {
          return resp.data;
        })
        .catch(error => {
          console.log(error);
        });
    });
  }

  async getDynamicSchema(
    database: string,
    table: string,
    columns: string[]
  ): Promise<Record<string, AdxColumnSchema[]>> {
    if (!database || !table || !Array.isArray(columns) || columns.length === 0) {
      return {};
    }
    const queryParts: string[] = [];

    const take = 'take 50000';
    const where = `where ${columns.map(column => `isnotnull(${column})`).join(' and ')}`;
    const project = `project ${columns.map(column => column).join(', ')}`;
    const summarize = `summarize ${columns.map(column => `buildschema(${column})`).join(', ')}`;

    queryParts.push(table);
    queryParts.push(take);
    queryParts.push(where);
    queryParts.push(project);
    queryParts.push(summarize);

    const query = this.buildQuery(queryParts.join('\n | '), {}, database);
    const response = await this.query({
      targets: [
        {
          ...query,
          querySource: 'schema',
        },
      ],
    } as DataQueryRequest<KustoQuery>).toPromise();

    return dynamicSchemaParser(response.data as DataFrame[]);
  }

  get variables() {
    return this.templateSrv.getVariables().map(v => `$${v.name}`);
  }

  // Used for annotations and templage variables
  private buildQuery(query: string, options: any, database: string): KustoQuery {
    if (!options) {
      options = {};
    }
    if (!options.hasOwnProperty('scopedVars')) {
      options['scopedVars'] = {};
    }

    const interpolatedQuery = interpolateKustoQuery(query, options['scopedVars']);

    return {
      ...defaultQuery,
      refId: `adx-${interpolatedQuery}`,
      resultFormat: 'table',
      rawMode: true,
      query: interpolatedQuery,
      database,
    };
  }

  // Used to get the schema directly
  doRequest(url: string, maxRetries = 1) {
    return this.backendSrv
      .datasourceRequest({
        url: this.url + url,
        method: 'GET',
      })
      .catch(error => {
        if (maxRetries > 0) {
          return this.doRequest(url, maxRetries - 1);
        }

        throw error;
      });
  }

  interpolateVariable(value: any, variable) {
    if (typeof value === 'string') {
      if (variable.multi || variable.includeAll) {
        return "'" + value + "'";
      } else {
        return value;
      }
    }

    if (typeof value === 'number') {
      return value;
    }

    const quotedValues = map(value, val => {
      if (typeof value === 'number') {
        return value;
      }

      return "'" + escapeSpecial(val) + "'";
    });
    return quotedValues.filter(v => v !== "''").join(',');
  }

  parseExpression(sections: QueryExpression | undefined, columns: AdxColumnSchema[] | undefined): string {
    return this.expressionParser.toQuery(sections, columns);
  }

  getDefaultEditorMode(): EditorMode {
    return this.defaultEditorMode;
  }

  async autoCompleteQuery(query: AutoCompleteQuery, columns: AdxColumnSchema[] | undefined): Promise<string[]> {
    const autoQuery = undefined; // this.expressionParser.toAutoCompleteQuery(query, columns);

    if (!autoQuery) {
      return [];
    }

    const kustQuery: KustoQuery = {
      ...defaultQuery,
      refId: `adx-${autoQuery}`,
      database: query.database,
      rawMode: true,
      query: autoQuery,
      resultFormat: 'table',
      querySource: 'autocomplete',
    };

    const response = await this.query(
      includeTimeRange({
        targets: [kustQuery],
      }) as DataQueryRequest<KustoQuery>
    ).toPromise();

    if (!Array.isArray(response?.data) || response.data.length === 0) {
      return [];
    }

    if (!Array.isArray(response.data[0].fields) || response.data[0].fields.length === 0) {
      return [];
    }

    const results = response.data[0].fields[0].values.toArray();
    const operator: QueryEditorOperator<string> = query.search.operator as QueryEditorOperator<string>; // why is this always T = QueryEditorOperatorValueType

    return operator.name === 'contains' ? sortStartsWithValuesFirst(results, operator.value) : results;
  }

  async testDatasource() {
    return new Promise((resolve, reject) => {
      const wsConn = new WebSocket(this.wsUrl);
      wsConn.onopen = function() {
        wsConn.close();
        resolve({
          status: 'success',
          message: 'Data source is working',
          title: 'Success',
        });
      };

      wsConn.onerror = function(error: any) {
        reject({
          status: 'error',
          message: 'Data source not accessible or access type is not set to Browser',
          title: 'Error',
        });
      };
    });
  }
}

const dynamicSchemaParser = (frames: DataFrame[]): Record<string, AdxColumnSchema[]> => {
  const result: Record<string, AdxColumnSchema[]> = {};

  for (const frame of frames) {
    for (const field of frame.fields) {
      const json = JSON.parse(field.values.get(0));

      if (json === null) {
        console.log('error with field', field);
        continue;
      }

      const columnSchemas: AdxColumnSchema[] = [];
      const columnName = field.name.replace('schema_', '');
      recordSchema(columnName, json, columnSchemas);
      result[columnName] = columnSchemas;
    }
  }

  return result;
};

const recordSchema = (columnName: string, schema: any, result: AdxColumnSchema[]) => {
  if (!schema) {
    console.log('error with column', columnName);
    return;
  }

  for (const name of Object.keys(schema)) {
    const key = `${columnName}.${name}`;

    if (typeof schema[name] === 'string') {
      result.push({
        Name: key,
        CslType: schema[name],
      });
      continue;
    }

    if (typeof schema[name] === 'object') {
      recordSchema(key, schema[name], result);
    }
  }
};

/**
 * this is a suuuper ugly way of doing this.
 */
const includeTimeRange = (option: any): any => {
  const range = (getTemplateSrv() as any)?.timeRange as TimeRange;

  if (!range) {
    return option;
  }

  return {
    ...option,
    range,
  };
};

const escapeSpecial = (value: string): string => {
  return value.replace(/\'/gim, "\\'");
};

export const sortStartsWithValuesFirst = (arr: string[], searchText: string) => {
  const text = searchText.toLowerCase();

  arr.sort((a, b) => {
    if (!a && !b) {
      return 0;
    }

    if (!a && b) {
      return -1;
    }

    if (a && !b) {
      return 1;
    }

    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    if (aLower.startsWith(text) && bLower.startsWith(text)) {
      return 0;
    }

    if (aLower.startsWith(text) && !bLower.startsWith(text) && bLower.includes(text, 1)) {
      return -1;
    }

    if (aLower.startsWith(text) && !bLower.includes(text, 1)) {
      return -1;
    }

    if (!aLower.startsWith(text) && aLower.includes(text, 1) && bLower.startsWith(text)) {
      return 1;
    }

    if (!aLower.includes(text, 1) && bLower.startsWith(text)) {
      return 1;
    }

    if (aLower.includes(text, 1) && !bLower.includes(text, 1)) {
      return -1;
    }

    if (!aLower.includes(text, 1) && bLower.includes(text, 1)) {
      return 1;
    }

    return 0;
  });

  return arr;
};
