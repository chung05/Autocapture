/**
 * 名片掃描應用程式的主邏輯 (app.js) - 最終穩定版
 * 修正：
 * 1. 增加時間穩定性檢查 (STABILITY_THRESHOLD) 以確保對焦和圖像清晰度。
 * 2. 修正透視變換 (Perspective Transform) 的頂點排序邏輯，確保校正正確。
 * 3. 強化下載圖片邏輯，確保下載的圖片格式正確。
 * 4. 新增視覺回饋：名片鎖定後，邊框顏色會動態變化，指示穩定度進度。(新增功能)
 */

// 宣告全域變數
let src = null; 
let dst = null; 
let streaming = false;
let canvasBuffer = null; 
let canvasBufferCtx = null; 

// 穩定性追蹤變數
let stableFrameCount = 0;
const STABILITY_THRESHOLD = 30; // 需要連續 15 幀穩定 (約 0.5 秒)

// 新增 DOM 元素參照
let snapshotContainer = null;
let snapshotImage = null;
let downloadSnapshot = null;
let retakeButton = null;

// ** 核心修正：定義全域 Module 物件，以避免 ReferenceError **
var Module = {
    onRuntimeInitialized: function() {
        // greenColor = new cv.Scalar(0, 255, 0, 255); // 移除固定顏色定義
        
        statusDiv.innerHTML = 'OpenCV 載入完成。請點擊「開始」按鈕。';
        console.log("DIAG: Module.onRuntimeInitialized 成功，OpenCV 核心已準備就緒。");
        
        if (startButton) {
            startButton.addEventListener('click', startCamera);
            startButton.disabled = false;
            startButton.innerHTML = '點擊開始';
        }

        // 初始化拍照結果顯示區域的事件監聽器 (強化下載邏輯)
        if (downloadSnapshot) {
            downloadSnapshot.addEventListener('click', () => {
                const img = document.getElementById('snapshotImage');
                // 由於 cv.imshow 到 img 標籤可能導致 Safari 下無法直接獲取 DataURL，
                // 我們使用臨時 Canvas 確保圖片數據的完整性。
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = img.naturalWidth || 800;
                tempCanvas.height = img.naturalHeight || 500;
                const tempCtx = tempCanvas.getContext('2d');
                
                // 檢查 img 是否有 src 或數據，如果沒有，無法繪製
                if (!img.src || img.naturalWidth === 0) {
                    // 使用非 alert 的方式提示使用者
                    statusDiv.innerHTML = '無法下載：圖片數據不存在。請重新拍攝。';
                    console.error('無法下載：圖片數據不存在。');
                    return;
                }
                
                tempCtx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);

                const a = document.createElement('a');
                a.href = tempCanvas.toDataURL('image/png'); // 使用 Canvas 確保導出
                a.download = 'business_card_corrected.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });
        }
        if (retakeButton) {
            retakeButton.addEventListener('click', resetAndStartCamera);
        }
    }
};

// 取得 DOM 元素參照
const video = document.getElementById('video');
const canvasOutput = document.getElementById('canvasOutput');
const statusDiv = document.getElementById('status');
const startButton = document.getElementById('startButton'); 
canvasBuffer = document.getElementById('canvasBuffer');

// 新增 DOM 元素參照
snapshotContainer = document.getElementById('snapshotContainer');
snapshotImage = document.getElementById('snapshotImage');
downloadSnapshot = document.getElementById('downloadSnapshot');
retakeButton = document.getElementById('retakeButton');


// ** 新增 DOM 檢查和初始狀態設定 **
if (startButton && canvasBuffer && snapshotContainer && snapshotImage && downloadSnapshot && retakeButton) {
    startButton.innerHTML = 'OpenCV 載入中...';
    startButton.disabled = true; 
} else {
    statusDiv.innerHTML = '致命錯誤：找不到必要的 DOM 元素。請確認 index.html 已更新！';
    console.error("DIAG ERROR: Missing critical DOM elements. Check index.html.");
}

// 重設並重新啟動相機 (用於重新拍攝)
function resetAndStartCamera() {
    snapshotContainer.style.display = 'none'; // 隱藏結果
    canvasOutput.style.display = 'block';     // 顯示預覽
    startButton.style.display = 'block';      // 顯示開始按鈕
    statusDiv.innerHTML = '點擊「開始」重新拍攝。';
    stableFrameCount = 0; // 重設計數器
}

// 2. 啟動相機並設定串流 
function startCamera() {
    startButton.style.display = 'none'; // 隱藏開始按鈕
    canvasOutput.style.display = 'block'; // 確保 Canvas 預覽顯示
    statusDiv.innerHTML = '正在請求相機權限...';
    
    // 在 iOS/Safari 上，需要更精確地請求環境鏡頭
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'environment',
            // 嘗試添加約束來改善對焦，雖然不保證有效，但值得一試
            // autoFocus: true, // 僅適用於特定的瀏覽器/環境
            // focusMode: "continuous" 
        }
    })
    .then(stream => {
        video.srcObject = stream;
        
        console.log("DIAG: getUserMedia 成功取得串流。等待 loadeddata 事件...");
        
        video.addEventListener('loadeddata', function initializeVideoAndStartLoop() {
            video.removeEventListener('loadeddata', initializeVideoAndStartLoop);

            console.log(`DIAG: loadeddata 事件觸發。串流解析度: ${video.videoWidth}x${video.videoHeight}`);

            if (video.videoWidth === 0 || video.videoHeight === 0) {
                 const errMsg = '致命錯誤：串流尺寸為 0x0。請重新整理或檢查相機資源是否被佔用。';
                 statusDiv.innerHTML = errMsg;
                 startButton.style.display = 'block'; // 顯示開始按鈕讓用戶重試
                 return;
            }

            canvasOutput.width = canvasBuffer.width = video.videoWidth;
            canvasOutput.height = canvasBuffer.height = video.videoHeight;
            
            canvasBufferCtx = canvasBuffer.getContext('2d');
            
            video.play().then(() => {
                statusDiv.innerHTML = '影像串流啟動成功，開始處理...';
                console.log("DIAG: video.play() 成功。準備進入處理迴圈...");
                
                streaming = true;
                processVideo(); 
                
            }).catch(e => {
                const errMsg = `錯誤：影像播放失敗。請檢查錯誤碼: ${e.message || e.name}`;
                statusDiv.innerHTML = errMsg;
                startButton.style.display = 'block'; // 顯示開始按鈕讓用戶重試
            });
        });
    })
    .catch(err => {
        const errMsg = `錯誤：無法存取相機。請檢查權限是否被拒絕。(Error: ${err.name} - ${err.message})`;
        statusDiv.innerHTML = errMsg;
        console.error("DIAG ERROR: 無法存取相機:", err);
        startButton.style.display = 'block'; // 顯示開始按鈕讓用戶重試
    });
}

// 3. 影像處理迴圈 (核心邏輯 - 修正動態邊框) 
function processVideo() {
    if (!streaming) return;

    if (src && !src.isDeleted()) {
        src.delete(); 
    }
    if (dst && !dst.isDeleted()) {
        dst.delete();
    }
    
    canvasBufferCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    src = cv.imread(canvasBuffer);
    dst = src.clone(); 

    let cardContour = detectCardBoundary(src); 

    if (cardContour) {
        if (isCardStableAndClear(cardContour)) {
             stableFrameCount++;
             
             // 計算穩定度百分比
             const stabilityRatio = Math.min(stableFrameCount, STABILITY_THRESHOLD) / STABILITY_THRESHOLD;
             
             // 顏色漸變：從橙色 (255, 165, 0) 透過黃色過渡到綠色 (0, 255, 0)
             // 這裡使用更簡單的線性插值模擬從黃 (100, 255, 0) 到綠 (0, 255, 0)
             const r = Math.round(100 * (1 - stabilityRatio)); 
             const g = 255;
             const b = 0; 
             
             const dynamicColor = new cv.Scalar(r, g, b, 255);
             const dynamicThickness = Math.round(3 + 3 * stabilityRatio); // 粗細從 3 漸變到 6

             drawContour(dst, cardContour, dynamicColor, dynamicThickness); 

             statusDiv.innerHTML = `名片已鎖定！請保持穩定。進度：${Math.min(stableFrameCount, STABILITY_THRESHOLD)} / ${STABILITY_THRESHOLD}`;
             
             if (stableFrameCount >= STABILITY_THRESHOLD) {
                // 達到穩定門檻，拍照
                takeSnapshot(src, cardContour); 
             }
             dynamicColor.delete(); // 釋放動態顏色
        } else {
             // 偵測到但還不穩定或不符合名片形狀
             stableFrameCount = 0; // 重設計數器
             const normalColor = new cv.Scalar(255, 165, 0, 255); // 橙色
             drawContour(dst, cardContour, normalColor, 3);
             normalColor.delete();

             statusDiv.innerHTML = '偵測到物體，但仍在調整對焦與角度。';
        }
        cardContour.delete(); 
    } else {
        stableFrameCount = 0; // 重設計數器
        statusDiv.innerHTML = '請將名片置於畫面中央。';
    }
    
    cv.imshow('canvasOutput', dst); 
    
    requestAnimationFrame(processVideo); 
}

// ----------------------------------------------------------------
// 4. 電腦視覺函式實作 
// ----------------------------------------------------------------

// 偵測名片輪廓的 CV 演算法 (無變動)
function detectCardBoundary(inputMat) {
    let gray = new cv.Mat();
    let blur = new cv.Mat();
    let canny = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
        cv.cvtColor(inputMat, gray, cv.COLOR_RGBA2GRAY, 0); 
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
        cv.Canny(blur, canny, 75, 200, 3, false); 
        cv.findContours(canny, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        
        let largestContour = null;
        let maxArea = 0;

        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);

            if (area < 1000) continue; 

            let arcLength = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            
            cv.approxPolyDP(contour, approx, 0.02 * arcLength, true);

            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                if (largestContour) largestContour.delete();
                largestContour = approx;
            } else {
                approx.delete();
            }
            contour.delete();
        }

        return largestContour;

    } catch (e) {
        return null;
    } finally {
        gray.delete();
        blur.delete();
        canny.delete();
        contours.delete();
        hierarchy.delete();
    }
}

// 判斷名片是否穩定和清晰的簡單邏輯 (無變動)
function isCardStableAndClear(contour) {
    if (!contour) return false;
    
    let area = cv.contourArea(contour);
    let totalArea = src.cols * src.rows; 
    
    // 條件 1: 面積檢查 (5% 到 85%)
    if (area < totalArea * 0.05 || area > totalArea * 0.85) { 
        return false;
    }

    // 條件 2: 凸性檢查
    let isConvex = cv.isContourConvex(contour);
    if (!isConvex) {
        return false;
    }
    
    // 條件 3: 長寬比檢查
    let rect = cv.minAreaRect(contour);
    let size = rect.size;
    let width = size.width;
    let height = size.height;

    if (width < height) {
        [width, height] = [height, width];
    }
    
    let aspectRatio = width / height;
    if (aspectRatio < 1.3 || aspectRatio > 2.5) { 
        return false;
    }

    return true; 
}

// 在影像上繪製輪廓 (修改：加入動態顏色和粗細)
function drawContour(outputMat, contour, color, thickness) {
    let contours = new cv.MatVector();
    contours.push_back(contour);

    cv.drawContours(outputMat, contours, 0, color, thickness, cv.LINE_8);
    
    let points = contour.data32S;
    for (let i = 0; i < points.length; i += 2) {
        let center = new cv.Point(points[i], points[i+1]);
        cv.circle(outputMat, center, thickness * 2, color, -1); 
    }
    
    contours.delete();
}

// 拍照功能 (修正頂點排序邏輯，確保透視變換正確)
function takeSnapshot(sourceMat, contour) {
    // 停止串流
    streaming = false;
    statusDiv.innerHTML = '處理中，請稍候...';

    // 1. 取得名片四個頂點並進行魯棒排序 (修正邏輯)
    let pointsArray = [];
    for (let i = 0; i < contour.rows; ++i) {
        pointsArray.push({
            x: contour.data32S[i * 2],
            y: contour.data32S[i * 2 + 1]
        });
    }
    
    // 魯棒排序方法：使用 x+y 總和來區分對角線，然後用 x 座標來區分剩餘的點。
    // 1.1. 根據 x+y 總和排序 (找到 TL 和 BR)
    const points_xy_sorted = [...pointsArray].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const pt_tl = points_xy_sorted[0]; // x+y 最小 = Top Left
    const pt_br = points_xy_sorted[3]; // x+y 最大 = Bottom Right

    // 1.2. 找到剩餘的兩個點 (TR 和 BL)
    const pt_mid_1 = points_xy_sorted[1];
    const pt_mid_2 = points_xy_sorted[2];

    // 1.3. 根據 x 座標區分 TR 和 BL (TR 的 x 座標較大)
    const pt_tr = pt_mid_1.x > pt_mid_2.x ? pt_mid_1 : pt_mid_2;
    const pt_bl = pt_mid_1.x < pt_mid_2.x ? pt_mid_1 : pt_mid_2;

    // 確保點的順序為：TL, TR, BR, BL (OpenCV 所需的順序)
    const finalPoints = [pt_tl, pt_tr, pt_br, pt_bl];

    // 2. 準備透視變換的來源和目標點
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        finalPoints[0].x, finalPoints[0].y, // TL
        finalPoints[1].x, finalPoints[1].y, // TR
        finalPoints[2].x, finalPoints[2].y, // BR
        finalPoints[3].x, finalPoints[3].y  // BL
    ]);

    // 計算名片校正後的大小
    let width = Math.sqrt(Math.pow(pt_tr.x - pt_tl.x, 2) + Math.pow(pt_tr.y - pt_tl.y, 2));
    let height = Math.sqrt(Math.pow(pt_bl.x - pt_tl.x, 2) + Math.pow(pt_bl.y - pt_tl.y, 2));
    
    // 由於計算出來的 width/height 可能是浮點數且受噪音影響，將其四捨五入為整數
    width = Math.round(width);
    height = Math.round(height);

    // 目標矩形點 (校正後的影像會變成這個大小)
    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        width, 0,
        width, height,
        0, height
    ]);

    // 3. 執行透視變換
    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    let dsize = new cv.Size(width, height);
    let correctedCard = new cv.Mat();
    cv.warpPerspective(sourceMat, correctedCard, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // 4. 將校正後的圖片顯示到 img 標籤
    cv.imshow(snapshotImage, correctedCard);
    snapshotImage.style.width = '100%'; // 確保圖片在容器內自適應
    snapshotImage.style.height = 'auto';

    // 釋放記憶體
    srcTri.delete();
    dstTri.delete();
    M.delete();
    correctedCard.delete();

    // 隱藏預覽 Canvas，顯示結果
    canvasOutput.style.display = 'none';
    snapshotContainer.style.display = 'block';

    statusDiv.innerHTML = '拍攝完成，已自動校正。';
    console.log("快照已拍攝，透視變換完成並顯示。");

    // 停止相機串流 (真正停止硬體)
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
}
