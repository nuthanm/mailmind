// src/components/ResizableLayout.jsx
import { useState, useCallback, useRef } from "react";

const MIN_LEFT = 160;
const MAX_LEFT = 420;
const MIN_RIGHT = 180;
const MAX_RIGHT = 560;

export default function ResizableLayout({ left, center, right }) {
  const [leftW, setLeftW] = useState(220);
  const [rightW, setRightW] = useState(320);
  const leftHandleRef = useRef(null);
  const rightHandleRef = useRef(null);

  const startResize = useCallback((side, startX, startW) => {
    const handle =
      side === "left" ? leftHandleRef.current : rightHandleRef.current;
    if (handle) handle.classList.add("dragging");

    const onMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const delta = clientX - startX;
      if (side === "left") {
        setLeftW((w) => Math.min(MAX_LEFT, Math.max(MIN_LEFT, startW + delta)));
      } else {
        setRightW((w) =>
          Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, startW - delta)),
        );
      }
    };

    const onUp = () => {
      if (handle) handle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onLeftMouseDown = (e) => startResize("left", e.clientX, leftW);
  const onRightMouseDown = (e) => startResize("right", e.clientX, rightW);
  const onLeftTouch = (e) => {
    e.preventDefault();
    startResize("left", e.touches[0].clientX, leftW);
  };
  const onRightTouch = (e) => {
    e.preventDefault();
    startResize("right", e.touches[0].clientX, rightW);
  };

  return (
    <div className="resizable-layout">
      {/* Left panel */}
      <div
        style={{
          width: leftW,
          flexShrink: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {left}
      </div>

      {/* Left drag handle */}
      <div
        ref={leftHandleRef}
        className="resize-handle"
        onMouseDown={onLeftMouseDown}
        onTouchStart={onLeftTouch}
        title="Drag to resize"
      />

      {/* Center panel */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {center}
      </div>

      {/* Right drag handle */}
      <div
        ref={rightHandleRef}
        className="resize-handle"
        onMouseDown={onRightMouseDown}
        onTouchStart={onRightTouch}
        title="Drag to resize"
      />

      {/* Right panel */}
      <div
        style={{
          width: rightW,
          flexShrink: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {right}
      </div>
    </div>
  );
}
