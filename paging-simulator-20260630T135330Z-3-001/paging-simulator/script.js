const form = document.getElementById('simForm');
const referenceInput = document.getElementById('referenceInput');
const framesInput = document.getElementById('framesInput');
const algorithmSelect = document.getElementById('algorithmSelect');
const statusMessage = document.getElementById('statusMessage');
const pagingRows = document.getElementById('pagingRows');
const pagingHeaderRow = document.getElementById('pagingHeaderRow');
const solutionSummary = document.getElementById('solutionSummary');
const statsGrid = document.getElementById('statsGrid');
const resetBtn = document.getElementById('resetBtn');
const sampleBtn = document.getElementById('sampleBtn');
const themeToggle = document.getElementById('themeToggle');

let simulationData = null;
let currentStep = 0;
let autoplayTimer = null;

function setStatus(message, type = '') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`.trim();
}

function parseReferences(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error('Please provide a page reference string.');
  }

  const parts = trimmed.split(/\s+/);
  const invalid = parts.find((part) => !/^[A-Za-z0-9]+$/.test(part));
  if (invalid) {
    throw new Error('References must be space-separated alphanumeric tokens.');
  }

  return parts;
}

function parseFrames(rawValue) {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Number of frames must be a positive integer.');
  }
  return value;
}

function simulatePaging(references, frameCount, algorithm) {
  const frames = Array.from({ length: frameCount }, () => null);
  const history = [];
  const fifoQueue = [];
  const lastUsed = Array.from({ length: frameCount }, () => -1);
  const lruOrder = [];
  let pageHits = 0;
  let pageFaults = 0;

  references.forEach((reference, index) => {
    const beforeFrames = [...frames];

    let hit = false;
    let newPage = null;
    let replacedPage = null;
    let replacedIndex = null;
    let loadedIndex = null;

    const hitFrameIndex = frames.findIndex((value) => value === reference);
    if (hitFrameIndex !== -1) {
      hit = true;
      pageHits += 1;
      if (algorithm === 'lru') {
        const orderIndex = lruOrder.indexOf(reference);
        if (orderIndex !== -1) {
          lruOrder.splice(orderIndex, 1);
        }
        lruOrder.unshift(reference);
        lastUsed[hitFrameIndex] = index;
      }
    } else {
      pageFaults += 1;
      const emptyIndex = frames.findIndex((value) => value === null);

      if (emptyIndex !== -1) {
        frames[emptyIndex] = reference;
        loadedIndex = emptyIndex;
        newPage = reference;
        if (algorithm === 'fifo') {
          fifoQueue.push(emptyIndex);
        }
        if (algorithm === 'lru') {
          lruOrder.unshift(reference);
          lastUsed[emptyIndex] = index;
        }
      } else {
        if (algorithm === 'fifo') {
          replacedIndex = fifoQueue.shift();
          replacedPage = frames[replacedIndex];
          frames[replacedIndex] = reference;
          fifoQueue.push(replacedIndex);
        } else {
          let victimIndex = 0;
          let oldest = lastUsed[0];
          for (let i = 1; i < frameCount; i += 1) {
            if (lastUsed[i] < oldest) {
              oldest = lastUsed[i];
              victimIndex = i;
            }
          }
          replacedIndex = victimIndex;
          replacedPage = frames[victimIndex];
          frames[victimIndex] = reference;
          lastUsed[victimIndex] = index;

          const replacedOrderIndex = lruOrder.indexOf(replacedPage);
          if (replacedOrderIndex !== -1) {
            lruOrder.splice(replacedOrderIndex, 1);
          }
          lruOrder.unshift(reference);
        }
        newPage = reference;
      }
    }

    const afterFrames = frames.map((value, frameIndex) => {
      const beforeValue = beforeFrames[frameIndex];
      let status = 'stable';
      if (value === null) {
        status = 'empty';
      } else if (hit && hitFrameIndex === frameIndex) {
        status = 'hit';
      } else if (loadedIndex === frameIndex) {
        status = 'new';
      } else if (replacedIndex === frameIndex) {
        status = 'replaced';
      } else if (beforeValue !== value && beforeValue !== null && value !== null) {
        status = 'stable';
      }
      return { value, status, frameIndex };
    });

    let orderedFrames = null;
    if (algorithm === 'lru') {
      orderedFrames = [...lruOrder];
    } else if (algorithm === 'fifo') {
      orderedFrames = fifoQueue
        .map((frameIndex) => frames[frameIndex])
        .reverse();
    }

    const outcome = hit ? 'Page Hit' : 'Page Fault';
    history.push({
      step: index + 1,
      reference,
      outcome,
      beforeFrames,
      afterFrames,
      hit,
      newPage,
      replacedPage,
      replacedIndex,
      loadedIndex,
      frames: [...frames],
      lastUsed: [...lastUsed],
      orderedFrames,
    });
  });

  return {
    references,
    frameCount,
    algorithm,
    history,
    pageHits,
    pageFaults,
    hitRatio: pageHits / references.length,
    faultRatio: pageFaults / references.length,
    hitPercentage: (pageHits / references.length) * 100,
    faultPercentage: (pageFaults / references.length) * 100,
  };
}

function renderPagingHeader(data) {
  pagingHeaderRow.innerHTML = '<th>Frame</th>';
  data.history.forEach((step) => {
    pagingHeaderRow.insertAdjacentHTML(
      'beforeend',
      `<th class="step-header">${step.reference}</th>`
    );
  });
}

function renderPagingTable(data, activeStep = null) {
  pagingRows.innerHTML = '';
  renderPagingHeader(data);

  for (let frameIndex = 0; frameIndex < data.frameCount; frameIndex += 1) {
    const row = document.createElement('tr');
    const cells = [`<th class="frame-label">Frame ${frameIndex + 1}</th>`];

    data.history.forEach((step, stepIndex) => {
      const frame = step.afterFrames[frameIndex];
      const classes = ['frame-cell', 'timeline-cell', frame.status];
      if (frame.value === null) {
        classes.push('empty');
      }
      const cellClass = stepIndex === activeStep ? 'active-step' : '';
      const valueText = frame.value === null ? '—' : frame.value;
      cells.push(
        `<td class="${cellClass}"><div class="${classes.join(' ')}"><span class="frame-cell-value">${valueText}</span></div></td>`
      );
    });

    row.innerHTML = cells.join('');
    pagingRows.appendChild(row);
  }

  const resultRow = document.createElement('tr');
  const resultCells = ['<th class="frame-label">Result</th>'];

  data.history.forEach((step, stepIndex) => {
    const resultClass = step.hit ? 'badge hit' : 'badge replaced';
    const resultLabel = step.hit ? 'H' : 'F';
    const cellClass = stepIndex === activeStep ? 'active-step' : '';
    resultCells.push(
      `<td class="${cellClass}"><div class="indicator-cell"><span class="${resultClass}">${resultLabel}</span></div></td>`
    );
  });

  resultRow.innerHTML = resultCells.join('');
  pagingRows.appendChild(resultRow);
}

function renderSolutionSummary(data) {
  const stepColumns = data.history
    .map((step) => `<th class="step-header">${step.reference}</th>`)
    .join('');

  const frameRows = Array.from({ length: data.frameCount }, (_, frameIndex) => {
    const rowCells = data.history
      .map((step) => {
        const ordered = step.orderedFrames && step.orderedFrames.length > 0 ? step.orderedFrames : step.frames;
        const value = ordered[frameIndex] === undefined ? null : ordered[frameIndex];
        return `<td class="timeline-cell"><div class="frame-state-item">${value === null ? '—' : value}</div></td>`;
      })
      .join('');

    return `
      <tr>
        <th class="frame-label">Frame ${frameIndex + 1}</th>
        ${rowCells}
      </tr>
    `;
  }).join('');

  solutionSummary.innerHTML = `
    <table class="solution-table solution-timeline">
      <thead>
        <tr>
          <th>Frame State</th>
          ${stepColumns}
        </tr>
      </thead>
      <tbody>
        ${frameRows}
      </tbody>
    </table>
  `;
}

function renderStatistics(data) {
  const stats = [
    { label: 'Total Page Hits', value: data.pageHits, className: 'hit' },
    { label: 'Total Page Faults', value: data.pageFaults, className: 'fault' },
    { label: 'Hit Ratio', value: data.hitRatio.toFixed(2), className: 'ratio' },
    { label: 'Fault Ratio', value: data.faultRatio.toFixed(2), className: 'ratio' },
    { label: 'Hit Percentage', value: `${data.hitPercentage.toFixed(2)}%`, className: 'percent' },
    { label: 'Fault Percentage', value: `${data.faultPercentage.toFixed(2)}%`, className: 'percent' },
  ];

  statsGrid.innerHTML = stats
    .map(
      (stat) => `
        <div class="stat-card ${stat.className}">
          <div>
            <span>${stat.label}</span>
            <div class="stat-value">${stat.value}</div>
          </div>
        </div>
      `
    )
    .join('');
}

function renderSimulation(data, activeStep = null) {
  renderPagingTable(data, activeStep);
  renderSolutionSummary(data);
  renderStatistics(data);
}

function runSimulation() {
  try {
    const references = parseReferences(referenceInput.value);
    const frameCount = parseFrames(framesInput.value);
    const algorithm = algorithmSelect.value;

    simulationData = simulatePaging(references, frameCount, algorithm);
    currentStep = 0;
    clearInterval(autoplayTimer);
    renderSimulation(simulationData, currentStep);
    setStatus(`Simulated ${algorithm.toUpperCase()} with ${references.length} references over ${frameCount} frames.`, 'success');
  } catch (error) {
    simulationData = null;
    pagingRows.innerHTML = '';
    solutionSummary.innerHTML = '';
    statsGrid.innerHTML = '';
    setStatus(error.message, 'error');
  }
}

function resetInputs() {
  form.reset();
  currentStep = 0;
  clearInterval(autoplayTimer);
  simulationData = null;
  pagingRows.innerHTML = '';
  solutionSummary.innerHTML = '';
  statsGrid.innerHTML = '';
  setStatus('Ready for a new simulation.', '');
}

function loadSampleData() {
  referenceInput.value = '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1';
  framesInput.value = '3';
  algorithmSelect.value = 'fifo';
  runSimulation();
}

function toggleTheme() {
  document.documentElement.classList.toggle('light');
  const isLight = document.documentElement.classList.contains('light');
  themeToggle.textContent = isLight ? '☀️ Light Mode' : '🌙 Dark Mode';
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSimulation();
});

resetBtn.addEventListener('click', resetInputs);
sampleBtn.addEventListener('click', loadSampleData);
themeToggle.addEventListener('click', toggleTheme);
setStatus('Enter a reference string and number of frames to begin.', '');
