(() => {
  'use strict';

  const libraryPath = '/assets/vendor/jspdf-4.2.1.umd.min.js';
  const fontPath = '/assets/vendor/report-font.json';
  const utc = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  });
  let resources;

  function loadLibrary() {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = libraryPath;
      script.addEventListener('load', () => {
        if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error('PDF library unavailable'));
        script.remove();
      }, { once: true });
      script.addEventListener('error', () => {
        script.remove();
        reject(new Error('PDF library unavailable'));
      }, { once: true });
      document.head.append(script);
    });
  }

  function loadResources() {
    if (!resources) {
      const font = fetch(fontPath).then(response => {
        if (!response.ok) throw new Error('PDF font unavailable');
        return response.json();
      }).then(data => data.font);
      resources = Promise.all([loadLibrary(), font]).catch(error => {
        resources = undefined;
        throw error;
      });
    }
    return resources;
  }

  function formatUtc(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? utc.format(date) + ' UTC' : 'Unknown';
  }

  function safeSourceUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        return url.href.replace(/[()\\]/g, token => '%' + token.charCodeAt(0).toString(16));
      }
    } catch (_) { /* A missing or invalid link is printed as unavailable. */ }
    return null;
  }

  function makeReport(PDF, font, report) {
    const pdf = new PDF({ unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true });
    const country=report.kind==='country';
    pdf.setProperties({ title: country?'ClearIntel country intelligence briefing':'ClearIntel public news report', creator: 'ClearIntel Atlas' });
    pdf.addFileToVFS('ClearIntelReport.ttf', font);
    pdf.addFont('ClearIntelReport.ttf', 'ClearIntelReport', 'normal');
    pdf.setFont('ClearIntelReport');
    const glyph = pdf.getFont().metadata;
    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    const margin = 46, contentWidth = width - 2 * margin;
    const ink = '#132338', muted = '#435872', blue = '#116487';
    let y;

    function pageHeader() {
      pdf.setFillColor(10, 27, 45);
      pdf.rect(0, 0, width, 52, 'F');
      pdf.setFontSize(14).setTextColor(236, 248, 255).text('ClearIntel', margin, 32);
      pdf.setFontSize(9).setTextColor(138, 208, 228).text(country?'COUNTRY INTELLIGENCE':'PUBLIC NEWS RESEARCH', width - margin, 32, { align: 'right' });
      y = 79;
    }

    function ensureSpace(points) {
      if (y + points <= height - 58) return;
      pdf.addPage();
      pageHeader();
    }

    function canvasLines(value, ctx) {
      const lines = [];
      for (const paragraph of value.split('\n')) {
        let line = '';
        for (const word of paragraph.match(/\S+\s*/gu) || []) {
          if (line && ctx.measureText(line + word).width > contentWidth) {
            lines.push(line.trimEnd());
            line = '';
          }
          for (const character of word) {
            if (line && ctx.measureText(line + character).width > contentWidth) {
              lines.push(line.trimEnd());
              line = '';
            }
            line += character;
          }
        }
        lines.push(line.trimEnd());
      }
      return lines;
    }

    function textBlock(input, size = 10, colour = ink, gap = 6) {
      const value = String(input ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').normalize('NFC');
      if (!value) return;
      const lineHeight = size * 1.45;
      pdf.setFontSize(size);
      // Let the browser shape scripts outside the embedded font's coverage.
      const nativeText = Array.from(value).every(char => char === '\n' || glyph.characterToGlyph(char.codePointAt(0)));
      const canvas = nativeText ? null : document.createElement('canvas');
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        canvas.width = Math.ceil(contentWidth * 2);
        canvas.height = Math.ceil(lineHeight * 2);
        ctx.scale(2, 2);
        ctx.font = size + 'px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
      }
      const lines = ctx ? canvasLines(value, ctx) : pdf.splitTextToSize(value, contentWidth);
      for (const line of lines) {
        ensureSpace(lineHeight);
        if (ctx && line) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, contentWidth, lineHeight);
          ctx.fillStyle = colour;
          ctx.fillText(line, 0, lineHeight / 2);
          pdf.addImage(canvas, 'PNG', margin, y - size, contentWidth, lineHeight);
        } else {
          pdf.setFontSize(size).setTextColor(colour).text(line, margin, y);
        }
        y += lineHeight;
      }
      y += gap;
    }

    function sourceLink(value) {
      const url = safeSourceUrl(value);
      if (!url) { textBlock('Source link unavailable', 9, muted); return; }
      const label = 'Open original source';
      ensureSpace(17);
      pdf.setFontSize(9).setTextColor(blue).text(label, margin, y);
      pdf.link(margin, y - 10, pdf.getTextWidth(label), 13, { url });
      y += 17;
      textBlock(url,8,muted,4);
    }

    pageHeader();
    textBlock(country?'Country intelligence briefing':'Public news report', 23, ink, 12);
    textBlock((country?'Country: ':'Search: ') + report.query, 13);
    textBlock(country?'Source snapshot checked: '+formatUtc(report.checkedAt):'Feed window: ' + formatUtc(report.windowStart) + ' to ' + formatUtc(report.windowEnd), 10, muted);
    textBlock('Exported: ' + formatUtc(report.exportedAt), 10, muted);
    if(!country&&report.observedAt)textBlock('Results received by browser: '+formatUtc(report.observedAt),10,muted);
    textBlock('Evidence identifiers refer to this export only; source links and timestamps do not establish authenticity or independent verification.',9,muted);
    textBlock((country?'Eligible original linked reports':report.incidentOnly ? 'Incident-related headlines' : 'All matching headlines') +
      ' · ' + report.findings.length + ' of ' + report.total + ' findings included', 10, muted);
    textBlock('Sources queried: ' + (report.sources.join(', ') || 'None reported'), 10, muted);
    if (report.providerErrors.length) textBlock('Feed limitations: ' + report.providerErrors.join('; '), 10, '#825220');
    textBlock(report.notice, 9, muted);
    if (report.notes.trim()) {
      ensureSpace(42);
      textBlock('Researcher notes', 13, blue);
      textBlock(report.notes.trim());
    }

    ensureSpace(45);
    textBlock('Findings', 15, blue);
    if (!report.findings.length) textBlock('No matching headlines were returned in this search.', 10, muted);
    report.findings.forEach((finding, index) => {
      ensureSpace(110);
      pdf.setDrawColor(218, 229, 239).line(margin, y - 4, width - margin, y - 4);
      y += 12;
      textBlock('E'+String(index+1).padStart(3,'0')+' · ' + finding.title, 12, ink, 5);
      textBlock([finding.source, finding.provider].filter(Boolean).join(' · '), 9, muted, 3);
      textBlock((finding.time_basis || 'Feed time') + ': ' + formatUtc(finding.feed_time_utc), 9, muted, 3);
      if (report.incidentOnly || finding.incident_time_utc) {
        textBlock('Incident time: ' + formatUtc(finding.incident_time_utc), 9, muted, 3);
      }
      sourceLink(finding.url);
      y += 8;
    });

    const totalPages = pdf.getNumberOfPages();
    for (let page = 1; page <= totalPages; page++) {
      pdf.setPage(page);
      pdf.setDrawColor(218, 229, 239).line(margin, height - 41, width - margin, height - 41);
      pdf.setFontSize(8).setTextColor(muted).text('ClearIntel · Public-source research', margin, height - 25);
      pdf.text('Page ' + page + ' of ' + totalPages, width - margin, height - 25, { align: 'right' });
    }
    return pdf;
  }

  function auditManifest(report) {
    const short=(value,max)=>String(value??'').slice(0,max);
    return {
      schema:'clearintel.public-report.v1',
      report_kind:report.kind==='country'?'country-briefing':'news-research',
      exported_at_utc:report.exportedAt,
      query:short(report.query,300),
      observed_at_utc:report.checkedAt||report.observedAt||null,
      requested_window_start_utc:report.windowStart||null,
      requested_window_end_utc:report.windowEnd||null,
      incident_only:Boolean(report.incidentOnly),
      returned_findings:report.total,
      included_findings:report.findings.length,
      sources_checked:report.sources.map(value=>short(value,150)),
      provider_errors:report.providerErrors.map(value=>short(value,250)),
      limitations:short(report.notice,2500),
      researcher_notes:short(report.notes,2000),
      evidence:report.findings.map((finding,index)=>({
        id:'E'+String(index+1).padStart(3,'0'),
        title:short(finding.title,1000),
        publisher:short(finding.source,200),
        provider:short(finding.provider,150),
        source_url:safeSourceUrl(finding.url),
        source_time_utc:finding.feed_time_utc||null,
        time_basis:short(finding.time_basis||'Feed time',80),
        reported_incident_time_utc:finding.incident_time_utc||null,
        verification:'Not independently verified'
      }))
    };
  }
  function downloadManifest(report){
    const blob=new Blob([JSON.stringify(auditManifest(report),null,2)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download='ClearIntel-evidence-'+new Date(report.exportedAt).toISOString().slice(0,10)+'.json';
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function download(report) {
    const [PDF, font] = await loadResources();
    const day = new Date(report.exportedAt).toISOString().slice(0, 10);
    makeReport(PDF, font, report).save('ClearIntel-'+(report.kind==='country'?'country-briefing':'news-report')+'-' + day + '.pdf');
  }

  window.ClearIntelReport = { download, downloadManifest, auditManifest };
})();
