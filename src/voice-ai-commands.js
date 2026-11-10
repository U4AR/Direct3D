// Exact interface commands only; design interpretation remains with the model.
export function voiceAICommand(text){
 const words=String(text||'').toLowerCase().replace(/[.,!?]/g,'').trim().replace(/\s+/g,' ');
 if(/^(?:please )?(?:start recording drawing|record drawing example)(?: please)?$/.test(words))return 'record-start';
 if(/^(?:please )?(?:save drawing example|stop recording drawing)(?: please)?$/.test(words))return 'record-stop';
 if(/^(?:please )?(?:enable|resume|start|turn on) (?:the )?(?:ai|automatic ai)(?: please)?$/.test(words)||words==='ai on')return 'enable';
 if(/^(?:please )?(?:disable|pause|turn off) (?:the )?(?:ai|automatic ai)(?: please)?$/.test(words)||words==='ai off')return 'pause';
 if(/^(?:please )?(?:stop|cancel)(?: (?:the )?(?:ai|creation|build))?(?: please)?$/.test(words))return 'stop';
 if(/^(?:please )?(?:retry|try again|run ai|continue|continue building)(?: please)?$/.test(words))return 'retry';
 return null;
}
