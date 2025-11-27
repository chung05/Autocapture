// app.js (修正後的 startCamera 函式)

function startCamera() {
    // navigator.mediaDevices.getUserMedia...
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment', // 優先使用後置鏡頭
            // <<<< 修正點：移除可能導致 iOS 失敗的進階 focusMode 限制 >>>>
            // advanced: [{ focusMode: 'continuous' }] 
        }
    })
    .then(stream => {
        // ... (其他程式碼不變)
        video.srcObject = stream;
        video.onloadedmetadata = () => {
        // ...
