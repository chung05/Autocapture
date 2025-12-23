/**
 * 名片掃描器核心邏輯
 * 參考 Dynamsoft OpenCV.js Document Scanner 實作
 */

let streaming = false;
let video = document.getElementById('video');
let canvasOutput = document.getElementById('canvasOutput');
let ctxOutput = canvasOutput.getContext('2d');
let statusText = document.getElementById('statusText');
let loadingText = document.getElementById('loadingText');
let progressBar = document.getElementById('progressBar');
let progressBox = document.getElementById('progressBox');

// 穩定性追蹤變數
let stableCount = 0;
const STABLE_REQUIRED = 30; // 穩定幀數閾值
let lastRect = null;

// 1. 初始化與 OpenCV 檢查 (Polling 機制)
function checkOpenCVReady() {
    if (typeof cv !== 'undefined' && cv.Mat) {
        loadingText.style.display = 'none';
        statusText.innerText = '系統已就緒，正在請求相機...';
        initEventListeners();
        startVideo();
    } else {
        setTimeout(checkOpenCVReady, 200);
    }
}

function initEventListeners() {
    document.getElementById('btnDownload').onclick = downloadImg;
    document.getElementById('btnRestart').onclick = restartScan;
}

// 2. 啟動視訊流
async function startVideo() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: "environment", 
                width: { ideal: 1280 }, 
                height: { ideal: 720 } 
            } 
        });
        video.srcObject = stream;
        video.play();
        streaming = true;
        requestAnimationFrame(processFrame);
    } catch (err) {
        statusText.innerText = "無法開啟相機: " + err.name;
        console.error(err);
    }
}

// 3. 每一幀的影像處理
function processFrame() {
    if (!streaming) return;

    // 確保 Canvas 尺寸與視訊一致
    if (canvasOutput.width !== video.videoWidth) {
        canvasOutput.width = video.videoWidth;
        canvasOutput.height = video.videoHeight;
    }

    // 繪製原始影像到畫布
    ctxOutput.drawImage(video, 0, 0, canvasOutput.width, canvasOutput.height);
    
    let src = cv.imread(canvasOutput);
    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let edged = new cv.Mat();

    // 影像預處理
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edged, 75, 200);

    // 尋找輪廓
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let cardContour = null;
    let maxArea = 0;

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        
        // 篩選足夠大的輪廓
        if (area > (src.rows * src.cols * 0.1)) {
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

            // 若為四邊形且面積最大
            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                if (cardContour) cardContour.delete();
                cardContour = approx;
            } else {
                approx.delete();
            }
        }
    }

    // 4. 繪製追蹤框與穩定性判斷
    if (cardContour) {
        // 標示偵測到的名片位置 (綠色線條)
        drawDetectionBox(canvasOutput, cardContour);
        
        if (checkStability(cardContour)) {
            stableCount++;
            progressBox.style.display = 'block';
            progressBar.style.width = (stableCount / STABLE_REQUIRED * 100) + '%';
            statusText.innerText = "請保持靜止，正在自動拍照...";

            if (stableCount >= STABLE_REQUIRED) {
                // 執行拍照與透視變換裁切
                captureAndTransform(src, cardContour);
                // 清理記憶體
                src.delete(); gray.delete(); blurred.delete(); edged.delete();
                contours.delete(); hierarchy.delete();
                return; // 跳出循環
            }
        } else {
            stableCount = 0;
            progressBar.style.width = '0%';
            statusText.innerText = "偵測到名片，對準中...";
        }
    } else {
        stableCount = 0;
        progressBox.style.display = 'none';
        statusText.innerText = "正在尋找名片邊緣...";
    }

    // 清理本幀資源
    src.delete(); gray.delete(); blurred.delete(); edged.delete();
    contours.delete(); hierarchy.delete();
    if (cardContour) cardContour.delete();

    if (streaming) requestAnimationFrame(processFrame);
}

// 繪製追蹤線條
function drawDetectionBox(canvas, contour) {
    let ctx = canvas.getContext('2d');
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(contour.data32S[0], contour.data32S[1]);
    for (let i = 1; i < 4; i++) {
        ctx.lineTo(contour.data32S[i * 2], contour.data32S[i * 2 + 1]);
    }
    ctx.closePath();
    ctx.stroke();

    // 繪製角落指示器
    ctx.fillStyle = "#10b981";
    for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(contour.data32S[i * 2], contour.data32S[i * 2 + 1], 6, 0, Math.PI * 2);
        ctx.fill();
    }
}

// 穩定性演算法
function checkStability(contour) {
    let m = cv.moments(contour);
    let cx = m.m10 / m.m00;
    let cy = m.m01 / m.m00;
    let current = { cx, cy, area: m.m00 };

    if (!lastRect) {
        lastRect = current;
        return false;
    }

    let dist = Math.sqrt(Math.pow(cx - lastRect.cx, 2) + Math.pow(cy - lastRect.cy, 2));
    let areaChange = Math.abs(current.area - lastRect.area) / lastRect.area;
    lastRect = current;

    // 門檻：位移 < 4px 且面積變化 < 1%
    return dist < 4 && areaChange < 0.01;
}

// 5. 自動裁切邏輯
function captureAndTransform(srcMat, contour) {
    streaming = false;
    
    // 停止相機
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }

    // 1. 頂點排序 (TL, TR, BR, BL)
    let pts = [];
    for (let i = 0; i < 4; i++) {
        pts.push({ x: contour.data32S[i * 2], y: contour.data32S[i * 2 + 1] });
    }
    pts.sort((a, b) => a.y - b.y);
    let top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
    let bot = pts.slice(2, 4).sort((a, b) => b.x - a.x);
    let sorted = [top[0], top[1], bot[0], bot[1]];

    // 2. 計算目標尺寸
    let w = Math.max(Math.hypot(sorted[1].x - sorted[0].x, sorted[1].y - sorted[0].y),
                     Math.hypot(sorted[2].x - sorted[3].x, sorted[2].y - sorted[3].y));
    let h = Math.max(Math.hypot(sorted[3].x - sorted[0].x, sorted[3].y - sorted[0].y),
                     Math.hypot(sorted[2].x - sorted[1].x, sorted[2].y - sorted[1].y));

    // 3. 變換矩陣
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        sorted[0].x, sorted[0].y, sorted[1].x, sorted[1].y,
        sorted[2].x, sorted[2].y, sorted[3].x, sorted[3].y
    ]);
    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);

    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    let dsize = new cv.Size(w, h);
    let resultMat = new cv.Mat();
    cv.warpPerspective(srcMat, resultMat, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // 4. 顯示結果
    let buffer = document.getElementById('canvasBuffer');
    buffer.width = w;
    buffer.height = h;
    cv.imshow(buffer, resultMat);
    
    document.getElementById('resultImg').src = buffer.toDataURL();
    document.getElementById('scanView').style.display = 'none';
    document.getElementById('resultView').style.display = 'flex';
    statusText.innerText = "掃描完成！";

    // 釋放記憶體
    srcTri.delete(); dstTri.delete(); M.delete(); resultMat.delete();
}

function restartScan() {
    document.getElementById('resultView').style.display = 'none';
    document.getElementById('scanView').style.display = 'block';
    stableCount = 0;
    lastRect = null;
    startVideo();
}

function downloadImg() {
    let link = document.createElement('a');
    link.download = 'business-card-scan.png';
    link.href = document.getElementById('resultImg').src;
    link.click();
}

// 啟動入口
window.onload = checkOpenCVReady;
