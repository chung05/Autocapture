/* 確保 body 佔滿整個視窗高度 */
html, body {
    height: 100%;
}

/* 確保 video 和 canvas 100% 寬度並保持長寬比，隱藏 video 標籤 */
#video {
    display: none;
}

/* 讓 canvas 填滿其容器 */
#canvasOutput {
    width: 100%;
    height: 100%;
    object-fit: contain; /* 確保內容完整顯示 */
    border-radius: 0.5rem;
}

/* 結果顯示容器 - 讓其佔滿空間並覆蓋預覽區 */
#snapshotContainer {
    display: none; /* 預設在 JS 啟動前隱藏 */
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
    display: flex; /* 讓 JS 顯示時使用 Flex 佈局 */
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background-color: #0d121c; 
    z-index: 10;
}

#snapshotImage {
    max-width: 100%;
    max-height: 75vh; /* 限制高度以確保按鈕有空間 */
    height: auto;
    border: 2px solid #3b82f6;
    border-radius: 0.75rem;
    box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
    object-fit: contain;
}

/* 調整主要內容區域在小螢幕上的佈局，佔用大部分高度 (解決 iPhone 畫面不合適問題) */
.main-container {
    width: 100%;
    max-width: 500px; /* 限制寬度在桌面模式 */
    height: 90vh; /* 在移動設備上佔用大部分高度，確保內容垂直填充 */
    display: flex;
    flex-direction: column;
}
