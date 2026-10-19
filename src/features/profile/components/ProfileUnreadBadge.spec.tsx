import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ProfileUnreadBadge } from './ProfileUnreadBadge';
jest.mock('@/theme',()=>({useTheme:()=>({colors:{error:'red',surface:'white',white:'white'}})}));
test.each([1, 12, 99])('shows %s unread notifications as a number',count=>{
 render(<ProfileUnreadBadge count={count} />);expect(screen.getByText(String(count), {includeHiddenElements:true})).toBeTruthy();
});
test('caps the displayed count at 99+',()=>{render(<ProfileUnreadBadge count={100} />);expect(screen.getByText('99+', {includeHiddenElements:true})).toBeTruthy();});
test('hides the badge when there are no unread notifications',()=>{const view=render(<ProfileUnreadBadge count={0} />);expect(view.toJSON()).toBeNull();});
