import React from 'react';
import { DataSourcePluginOptionsEditorProps, DataSourceSettings } from '@grafana/data';
import { AdxDataSourceOptions } from './types';
import { DataSourceHttpSettings } from '@grafana/ui';
import { LegacyForms } from '@grafana/ui';
const { FormField } = LegacyForms;

interface Props extends DataSourcePluginOptionsEditorProps<AdxDataSourceOptions> {}

const makeJsonUpdater = <T extends any>(field: keyof AdxDataSourceOptions) => (
  options: DataSourceSettings<AdxDataSourceOptions>,
  value: T
): DataSourceSettings<AdxDataSourceOptions> => {
  return {
    ...options,
    jsonData: {
      ...options.jsonData,
      [field]: value,
    },
  };
};

const setConnUrl = makeJsonUpdater('connUrl');

export const ConfigEditor = (props: Props) => {
  const { options, onOptionsChange } = props;
  return (
    <>
      <DataSourceHttpSettings
        defaultUrl="http://localhost:5001"
        dataSourceConfig={options}
        showAccessOptions={true}
        onChange={onOptionsChange}
      />
      <FormField
        label="Data URL"
        width={4}
        inputEl={
          <input
            className="gf-form-input width-16"
            value={options.jsonData.connUrl}
            type="text"
            min-length="0"
            onChange={value => onOptionsChange(setConnUrl(options, value.currentTarget.value))}
          />
        }
      />
    </>
  );
};
