/* eslint-disable prettier/prettier */
const packageJson = require('../package.json');

import { DataQuery, DataSourceJsonData } from '@grafana/data';
import {
  QueryEditorPropertyExpression,
  QueryEditorArrayExpression,
  QueryEditorExpressionType,
  QueryEditorOperatorExpression,
} from './editor/expressions';

export interface QueryExpression {
  from?: QueryEditorPropertyExpression;
  where: QueryEditorArrayExpression;
  reduce: QueryEditorArrayExpression;
  groupBy: QueryEditorArrayExpression;
  timeshift?: QueryEditorPropertyExpression;
}

type QuerySource = 'raw' | 'schema' | 'autocomplete' | 'visual';
export interface KustoQuery extends DataQuery {
  query: string;
  database: string;
  alias?: string;
  resultFormat: string;
  expression: QueryExpression;
  rawMode?: boolean;
  querySource: QuerySource;
  pluginVersion: string;
  pivot: string;
  realTime: string;
  dimention: string;
  logLimit: number;
}

export interface AutoCompleteQuery {
  database: string;
  search: QueryEditorOperatorExpression;
  expression: QueryExpression;
  index: string;
}

export enum EditorMode {
  Visual = 'visual',
  Raw = 'raw',
}

export const defaultQuery: Pick<
  KustoQuery,
  'query' | 'expression' | 'database' | 'querySource' | 'pluginVersion' | 'pivot' | 'realTime' | 'dimention' | 'logLimit'
> = {
  query: '',
  querySource: EditorMode.Raw,
  expression: {
    where: {
      type: QueryEditorExpressionType.And,
      expressions: [],
    },
    groupBy: {
      type: QueryEditorExpressionType.And,
      expressions: [],
    },
    reduce: {
      type: QueryEditorExpressionType.And,
      expressions: [],
    },
  },
  database: '',
  pluginVersion: packageJson.version,
  pivot: 'false',
  realTime: 'false',
  dimention: 'single',
  logLimit: 100,
};

export interface AdxDataSourceOptions extends DataSourceJsonData {
  connUrl?: string;
}

export interface AdxSchema {
  Databases: Record<string, AdxDatabaseSchema>;
}

export interface AdxDatabaseSchema {
  Name: string;
  Tables: Record<string, AdxTableSchema>;
  ExternalTables: Record<string, AdxTableSchema>;
}

export interface AdxTableSchema {
  Name: string;
  OrderedColumns: AdxColumnSchema[];
}

export interface AdxColumnSchema {
  Name: string;
  CslType: string;
}
