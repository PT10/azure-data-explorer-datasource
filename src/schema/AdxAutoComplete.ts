import { KustoQuery, defaultQuery, AdxColumnSchema } from 'types';
import { DataQueryRequest, TimeRange } from '@grafana/data';
import { AdxDataSource } from '../datasource';
import { getTemplateSrv } from '@grafana/runtime';

export class AdxAutoComplete {
  constructor(
    private datasource: AdxDataSource,
    private columnSchema: AdxColumnSchema[] = [],
    private database?: string,
    private table?: string
  ) {}

  async search(searchTerm?: string, column?: string): Promise<string[]> {
    if (!searchTerm || !column || !this.table || !this.database) {
      return [];
    }

    const queryParts: string[] = [];
    const defaultTimeColum = findDefaultTimeColumn(this.columnSchema);

    queryParts.push(this.table);

    if (defaultTimeColum) {
      queryParts.push(`where $__timeFilter(${this.castIfDynamic(defaultTimeColum, this.columnSchema)})`);
    }

    queryParts.push(`where ${column} contains "${searchTerm}"`);
    queryParts.push('take 50000');
    queryParts.push(`distinct ${this.castIfDynamic(column, this.columnSchema)}`);
    queryParts.push('take 251');

    const kql = queryParts.join('\n| ');

    const query: KustoQuery = {
      ...defaultQuery,
      refId: `adx-${kql}`,
      database: this.database,
      rawMode: true,
      query: kql,
      resultFormat: 'table',
      querySource: 'autocomplete',
    };

    const response = await this.datasource
      .query(
        includeTimeRange({
          targets: [query],
        }) as DataQueryRequest<KustoQuery>
      )
      .toPromise();

    if (!Array.isArray(response?.data) || response.data.length === 0) {
      return [];
    }
    return response.data[0].fields[0].values.toArray();
  }

  private castIfDynamic(column: string, columns: AdxColumnSchema[]): string {
    if (!column || column.indexOf('.') < 0) {
      return column;
    }

    const columnSchema = columns.find(c => c.Name === column);
    const columnType = columnSchema?.CslType;

    if (!columnType) {
      return column;
    }

    const parts = column.split('.');

    return parts.reduce((result: string, part, index) => {
      if (!result) {
        return `todynamic(${part})`;
      }

      if (index + 1 === parts.length) {
        return `to${columnType}(${result}.${part})`;
      }

      return `todynamic(${result}.${part})`;
    }, '');
  }
}

const findDefaultTimeColumn = (columns: AdxColumnSchema[]): string | undefined => {
  const column = columns?.find(col => col.CslType === 'datetime');
  return column?.Name;
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
