import { AdxColumnSchema, AdxDatabaseSchema, AdxTableSchema } from '../types';
import { AdxDataSource } from '../datasource';
import { cache } from './cache';

const schemaKey = 'AdxSchemaResolver';

export class AdxSchemaResolver {
  constructor(private datasource: AdxDataSource) {}

  private createCacheKey(addition: string): string {
    return `${schemaKey}.${this.datasource.id}.${addition}`;
  }

  async getDatabases(): Promise<AdxDatabaseSchema[]> {
    const cacheKey = this.createCacheKey('db');
    const schema = await cache(cacheKey, () => this.datasource.getSchema());
    return Object.keys(schema.Databases).map(key => schema.Databases[key]);
  }

  async getTablesForDatabase(databaseName: string): Promise<AdxTableSchema[]> {
    const databases = await this.getDatabases();
    const database = databases.find(db => db.Name === databaseName);

    if (!database) {
      return [];
    }

    return Object.keys(database.Tables).map(key => database.Tables[key]);
  }

  async getColumnsForTable(databaseName: string, tableName: string): Promise<AdxColumnSchema[]> {
    const cacheKey = this.createCacheKey(`db.${databaseName}.${tableName}`);

    return cache(cacheKey, async () => {
      const tables = await this.getTablesForDatabase(databaseName);
      const table = tables.find(t => t.Name === tableName);

      if (!table) {
        return [];
      }

      /*const dynamicColumns = table.OrderedColumns.filter(column => column.CslType === 'dynamic').map(
        column => column.Name
      );*/

      const schemaByColumn = {
        results: {
          'adx-kafka\n | take 50000\n | where isnotnull(Col_0) and isnotnull(Col_1) and isnotnull(Col_21)\n | project Col_0, Col_1, Col_21\n | summarize buildschema(Col_0), buildschema(Col_1), buildschema(Col_21)': {
            refId:
              'adx-kafka\n | take 50000\n | where isnotnull(Col_0) and isnotnull(Col_1) and isnotnull(Col_21)\n | project Col_0, Col_1, Col_21\n | summarize buildschema(Col_0), buildschema(Col_1), buildschema(Col_21)',
            series: null,
            tables: null,
            dataframes: [
              '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',
            ],
          },
        },
      };
      //await this.datasource.getDynamicSchema(databaseName, tableName, dynamicColumns);

      return table.OrderedColumns.reduce((columns: AdxColumnSchema[], column) => {
        const schemaForDynamicColumn = schemaByColumn[column.Name];

        if (!Array.isArray(schemaForDynamicColumn)) {
          columns.push(column);
          return columns;
        }

        Array.prototype.push.apply(columns, schemaForDynamicColumn);
        return columns;
      }, []);
    });
  }
}
