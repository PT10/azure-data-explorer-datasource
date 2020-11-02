import React, { PropsWithChildren } from 'react';
import { InlineFormLabel } from '@grafana/ui';

export interface QueryEditorSectionProps {
  label: string;
}

export const QueryEditorSection: React.FC<PropsWithChildren<QueryEditorSectionProps>> = props => {
  return (
    <div className="gf-form">
      <InlineFormLabel className="query-keyword">{props.label}</InlineFormLabel>
      {props.children}
    </div>
  );
};
