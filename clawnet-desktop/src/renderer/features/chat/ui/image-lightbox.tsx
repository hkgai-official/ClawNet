import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  src: string;
  onClose: () => void;
}

/**
 * Fullscreen image viewer with zoom + rotate. Ports macOS
 * `ImageMessageView.swift:1-176` fullscreen viewer logic (scale 0.25..3.0,
 * rotation += 90°, close on Escape).
 *
 * Renders via `createPortal` so it escapes the message-bubble's clip/overflow.
 */
export function ImageLightbox({ src, onClose }: Props) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const zoomIn = () => setScale((s) => Math.min(3, s + 0.25));
  const zoomOut = () => setScale((s) => Math.max(0.25, s - 0.25));
  const rotate = () => setRotation((r) => r + 90);

  return createPortal(
    <div
      role="dialog"
      aria-label="Image viewer"
      onClick={onClose}
      data-testid="image-lightbox"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-scrim)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '85vh',
          objectFit: 'contain',
          transform: `scale(${scale}) rotate(${rotation}deg)`,
          transition: 'transform 0.2s ease',
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          display: 'flex',
          gap: 8,
          background: 'var(--color-scrim-control)',
          backdropFilter: 'blur(8px)',
          padding: 8,
          borderRadius: 8,
        }}
      >
        <button
          onClick={zoomOut}
          aria-label="Zoom out"
          style={lightboxBtnStyle}
        >
          −
        </button>
        <button
          onClick={zoomIn}
          aria-label="Zoom in"
          style={lightboxBtnStyle}
        >
          +
        </button>
        <button
          onClick={rotate}
          aria-label="Rotate"
          style={lightboxBtnStyle}
        >
          ↻
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          style={lightboxBtnStyle}
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}

const lightboxBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  background: 'transparent',
  border: 'none',
  color: 'white',
  cursor: 'pointer',
  fontSize: 16,
};
