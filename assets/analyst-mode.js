'use strict';
(() => {
  const button=document.getElementById('analyst-mode-toggle');
  if(!button)return;
  const key='clearintel.analysis-mode';
  function setMode(analyst, updateDetails){
    document.body.dataset.analysisMode=analyst?'analyst':'simple';
    button.setAttribute('aria-pressed',String(analyst));
    if(updateDetails)document.querySelectorAll('.country-coverage-details, .country-related-reports').forEach(details=>{details.open=analyst;});
  }
  let analyst=false;
  try { analyst=localStorage.getItem(key)==='analyst'; } catch {}
  setMode(analyst,false);
  button.hidden=false;
  button.addEventListener('click',()=>{
    analyst=!analyst;
    setMode(analyst,true);
    try { localStorage.setItem(key,analyst?'analyst':'simple'); } catch {}
  });
})();
