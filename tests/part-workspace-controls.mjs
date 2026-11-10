// Use the same disclosures a desktop user opens, and return focus to the canvas.
export async function previewSettings(page,change){
 const settings=page.locator('#part-settings');
 await settings.locator(':scope > summary').click();
 const options=settings.getByText('Preview settings',{exact:true});
 if(!await page.locator('#decision-auto').isVisible())await options.click();
 await change();
 if(await settings.getAttribute('open')!==null)await settings.locator(':scope > summary').click();
}
