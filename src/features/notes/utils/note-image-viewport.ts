interface ImageRegistration {
  contentTop: number;
  height: number;
  onVisibilityChange: (visible: boolean) => void;
  visible: boolean | undefined;
}

export interface NoteImageViewport {
  register: (
    topInWindow: number,
    height: number,
    onVisibilityChange: (visible: boolean) => void,
  ) => () => void;
  setViewport: (topInWindow: number, height: number) => void;
  setScrollOffset: (offset: number) => void;
}

export function createNoteImageViewport(): NoteImageViewport {
  const registrations = new Set<ImageRegistration>();
  let viewportTop = 0;
  let viewportHeight = 0;
  let scrollOffset = 0;
  let measured = false;

  const updateVisibility = () => {
    const preloadDistance = viewportHeight * 0.75;
    for (const registration of registrations) {
      const contentTop = registration.contentTop;
      const visible =
        measured && contentTop + registration.height >= scrollOffset - preloadDistance &&
        contentTop <= scrollOffset + viewportHeight + preloadDistance;
      if (visible === registration.visible) continue;
      registration.visible = visible;
      registration.onVisibilityChange(visible);
    }
  };

  return {
    register(topInWindow, height, onVisibilityChange) {
      const registration: ImageRegistration = {
        contentTop: topInWindow - viewportTop + scrollOffset,
        height,
        onVisibilityChange,
        visible: undefined,
      };
      registrations.add(registration);
      updateVisibility();
      return () => registrations.delete(registration);
    },
    setViewport(topInWindow, height) {
      // Registrations can precede the ScrollView's first native measurement.
      if (!measured) {
        for (const registration of registrations) registration.contentTop -= topInWindow;
        measured = true;
      }
      viewportTop = topInWindow;
      viewportHeight = height;
      updateVisibility();
    },
    setScrollOffset(offset) {
      scrollOffset = offset;
      updateVisibility();
    },
  };
}
