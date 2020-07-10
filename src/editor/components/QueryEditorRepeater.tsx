import React, { useState, useCallback } from 'react';
import { css } from 'emotion';
import { Button, stylesFactory } from '@grafana/ui';
import { QueryEditorExpression, QueryEditorExpressionType } from './types';
interface Props {
  children: (props: ChildProps) => React.ReactElement;
  value: QueryEditorRepeaterExpression;
  onChange: (expression: QueryEditorRepeaterExpression) => void;
}

interface ChildProps {
  value: QueryEditorExpression | undefined;
  onChange: (expression: QueryEditorExpression | undefined) => void;
  key: string;
}

export interface QueryEditorRepeaterExpression extends QueryEditorExpression {
  typeToRepeate: QueryEditorExpressionType;
  expressions: QueryEditorExpression[];
}

export const QueryEditorRepeater: React.FC<Props> = props => {
  const [values, setValues] = useState(props.value.expressions);
  const onChangeValue = useCallback(
    (expression: QueryEditorExpression | undefined, index: number) => {
      if (!expression) {
        return;
      }
      values.splice(index, 1, expression);
      setValues([...values]);
    },
    [setValues]
  );

  const onRemoveValue = useCallback(
    (index: number) => {
      values.splice(index, 1);
      setValues([...values]);
    },
    [setValues]
  );

  const styles = getStyles();

  if (values.length === 0) {
    return (
      <div className={styles.container}>
        <AddQueryEditor index={0} onChange={onChangeValue} typeToAdd={props.value.typeToRepeate} />
      </div>
    );
  }

  return (
    <div>
      {values.map((value, index) => {
        const onChange = (exp: QueryEditorExpression | undefined) => onChangeValue(exp, index);
        const containerStyles = !isFirstRow(index, values.length) ? styles.containerWithSpacing : styles.container;

        return (
          <div className={containerStyles}>
            {props.children({ value, onChange, key: `rptr-${index}` })}
            <RemoveQueryEditor index={index} onRemove={onRemoveValue} />
            {index !== 0 ? null : (
              <AddQueryEditor index={values.length} onChange={onChangeValue} typeToAdd={props.value.typeToRepeate} />
            )}
          </div>
        );
      })}
    </div>
  );
};

export const isRepeater = (expression: QueryEditorExpression): expression is QueryEditorRepeaterExpression => {
  return (expression as QueryEditorRepeaterExpression)?.type === QueryEditorExpressionType.OperatorRepeater;
};

const isFirstRow = (index: number, length: number): boolean => {
  return index + 1 === length;
};

interface AddQueryEditorProps {
  index: number;
  onChange: (expression: QueryEditorExpression | undefined, index: number) => void;
  typeToAdd: QueryEditorExpressionType;
}

const AddQueryEditor: React.FC<AddQueryEditorProps> = props => {
  const styles = getStyles();
  const onAddEditor = useCallback(() => props.onChange({ type: props.typeToAdd }, props.index), [props]);
  return <Button className={styles.addButton} variant="secondary" onClick={onAddEditor} icon="plus" />;
};

interface RemoveQueryEditorProps {
  index: number;
  onRemove: (index: number) => void;
}

const RemoveQueryEditor: React.FC<RemoveQueryEditorProps> = props => {
  const styles = getStyles();
  const onRemoveEditor = useCallback(() => props.onRemove(props.index), [props]);
  return <Button className={styles.removeButton} variant="secondary" onClick={onRemoveEditor} icon="minus" />;
};

const getStyles = stylesFactory(() => {
  const container = css`
    display: flex;
    flex-direction: row;
  `;

  return {
    container: container,
    removeButton: css`
      margin-right: 4px;
      margin-left: 4px;
    `,
    addButton: css`
      margin-right: 4px;
    `,
    containerWithSpacing: css`
      ${container}
      margin-bottom: 4px;
    `,
  };
});
