import React, { Suspense } from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { getNoteBlockEditorDOM } from './note-editor-loader.web';

const mockLoad = jest.fn();
// Jest's CommonJS VM cannot execute import(); browser smoke checks the real chunk.
jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return { ...actual, lazy: () => actual.lazy(() => mockLoad()) };
});

test('Web editor code is loaded only when the editor mounts and shows a local loading state', async () => {
  const Editor = getNoteBlockEditorDOM();
  expect(mockLoad).not.toHaveBeenCalled();
  mockLoad.mockResolvedValue({ default: () => <Text>Loaded editor</Text> });
  render(<Suspense fallback={<Text>Whole screen loading</Text>}><Editor {...({} as React.ComponentProps<typeof Editor>)} /></Suspense>);
  expect(screen.getByRole('progressbar')).toBeTruthy();
  expect(screen.queryByText('Whole screen loading')).toBeNull();
  await act(async () => {});
  expect(screen.getByText('Loaded editor')).toBeTruthy();
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
