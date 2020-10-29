/* eslint-disable */
/* tslint:disable */
///<reference path="../../node_modules/monaco-editor/monaco.d.ts" />
/* tslint:enable */
/* eslint-enable */

import React from 'react';
import { AdxSchema } from '../types';
import KustoCodeEditor from './kusto_code_editor';
import { css } from 'emotion';
import { InlineFormLabel, stylesFactory } from '@grafana/ui';

import config from 'grafana/app/core/config';

interface Props {
  content: string;
  defaultTimeField: string;
  pluginBaseUrl: string;
  getSchema: () => Promise<AdxSchema>;
  onChange: (val: string) => void;
  onExecute: () => void;
}

interface MonacoState {}

export class KustoMonacoEditor extends React.Component<Props, MonacoState> {
  monacoRef: React.RefObject<HTMLDivElement>;
  styles: { editor: string };
  kustoCodeEditor: KustoCodeEditor | undefined;

  constructor(props: Props) {
    super(props);
    this.styles = this.getStyles();
    this.monacoRef = React.createRef<HTMLDivElement>();
    this.state = {
      content: props.content,
    };

    if (!window.hasOwnProperty('monaco')) {
      (window as any).System.import(`/${props.pluginBaseUrl}/libs/monaco.min.js`).then(() => {
        setTimeout(() => {
          this.initMonaco();
        }, 1);
      });
    } else {
      setTimeout(() => {
        this.initMonaco();
      }, 1);
    }
  }

  initMonaco() {
    this.kustoCodeEditor = new KustoCodeEditor(
      this.monacoRef.current,
      this.props.defaultTimeField,
      this.props.getSchema,
      config
    );

    this.kustoCodeEditor.initMonaco(this.props.content);

    /* tslint:disable:no-bitwise */
    this.kustoCodeEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
      const newValue = this.kustoCodeEditor?.getValue();
      this.props.onChange(newValue!);
      this.props.onExecute();
    });
    /* tslint:enable:no-bitwise */

    this.kustoCodeEditor.setOnDidChangeModelContent(() => {
      const newValue = this.kustoCodeEditor?.getValue();
      this.props.onChange(newValue!);
    });

    window.onresize = () => {
      this.kustoCodeEditor?.resize();
    };
  }

  componentWillUnmount() {
    if (this.kustoCodeEditor) {
      this.kustoCodeEditor.disposeMonaco();
    }
  }

  getStyles = stylesFactory(() => ({
    editor: css`
      width: 70%;
      height: 60px;
    `,
  }));

  render() {
    return (
      <div className="gf-form-inline">
        <div className="gf-form" style={{ width: '100%', height: '70px' }}>
          <InlineFormLabel>Query</InlineFormLabel>
          <div id="content" tabIndex={0} className={this.styles.editor} ref={this.monacoRef}></div>
        </div>
      </div>
    );
  }
}
