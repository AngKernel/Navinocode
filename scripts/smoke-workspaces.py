"""Offline DOM smoke test using the actual production bundle.
Requires Python Playwright and Chromium. Run npm run build first.
Storage/fetch are doubles; this does NOT validate real extension/account sync.
No browser policies are changed and no network navigation is attempted.
"""
import json, os, pathlib, traceback
from playwright.sync_api import sync_playwright, expect
root=pathlib.Path(__file__).resolve().parents[1]
output=root/'qa-output'
output.mkdir(exist_ok=True)
KEY='navinocode_advanced_state'
checks=[]
def record(s): checks.append(s);print('PASS',s,flush=True)
def state(p): return p.evaluate('(key)=>JSON.parse(localStorage.getItem(key))',KEY)
def current(p):
 s=state(p);return next(w for w in s['workspaces'] if w['id']==s['activeWorkspaceId'])
def offline_render(page, values=None):
 page.set_content('<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div></body></html>')
 page.evaluate("""values=>{
   class MemoryStorage { values=new Map(Object.entries(values||{}));getItem(k){return this.values.get(k)??null}setItem(k,v){this.values.set(k,String(v))}removeItem(k){this.values.delete(k)}clear(){this.values.clear()} }
   Object.defineProperty(window,'localStorage',{value:new MemoryStorage()});
   Object.defineProperty(window,'sessionStorage',{value:new MemoryStorage()});
   window.fetch=async()=>({ok:false,status:503,json:async()=>({})});
 }""",values or {})
 page.add_style_tag(content=(root/'build/assets/popup.css').read_text())
 page.add_script_tag(content=(root/'build/assets/popup.js').read_text(),type='module')
 page.wait_for_timeout(250)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  ctx=browser.new_context(viewport={'width':1280,'height':900},locale='zh-CN')
  ctx.route('**/*', lambda route: route.abort())
  ctx.set_default_timeout(5000)
  errors=[]
  page=ctx.new_page();page.on('pageerror',lambda e: errors.append(str(e)))
  offline_render(page)
  expect(page.get_by_role('button',name='整理网站',exact=True).first).to_be_visible()
  assert len(current(page)['apps'])==8
  assert page.get_by_label('切换工作区',exact=True).count()==0
  page.evaluate('window.__noReload="sentinel"')
  record('new profile defaults and single workspace switcher hidden')
  page.get_by_role('button',name='整理网站',exact=True).first.click()
  dialog=page.get_by_role('dialog',name='整理网站')
  expect(dialog).to_be_visible()
  page.get_by_label('新文件夹名称',exact=True).fill('开发工具')
  page.get_by_label('创建文件夹',exact=True).click()
  folder=current(page)['folders'][0]['id']
  page.get_by_label('移动 GitHub',exact=True).select_option(folder)
  assert next(a for a in current(page)['apps'] if a['name']=='GitHub')['folderId']==folder
  assert dialog.get_by_role('link',name='GitHub',exact=False).count()==0
  dialog.get_by_role('navigation').get_by_role('button',name='开发工具',exact=False).click()
  expect(dialog.get_by_role('link',name='GitHub',exact=False)).to_be_visible()
  page.get_by_label('网站名称',exact=True).fill('文档站')
  page.get_by_label('网站地址',exact=True).fill('https://docs.example.test/start')
  page.get_by_role('button',name='添加网站',exact=True).click()
  assert len(current(page)['apps'])==9
  record('single folder membership moves app, add site within folder')
  page.get_by_label('选择 GitHub',exact=True).check();page.get_by_label('选择 文档站',exact=True).check()
  page.get_by_label('批量移动网站',exact=True).select_option('__root__')
  assert all(not a['folderId'] for a in current(page)['apps'])
  record('bulk move preserves all sites')
  dialog.locator('summary').click()
  page.get_by_label('新工作区名称',exact=True).fill('学习')
  page.get_by_label('创建空白工作区',exact=True).click()
  assert current(page)['apps']==[] and current(page)['settings']['todos']==[]
  assert page.evaluate('window.__noReload')=='sentinel'
  record('blank workspace does not clone and does not reload document')
  page.get_by_label('网站名称',exact=True).fill('学习入口')
  page.get_by_label('网站地址',exact=True).fill('study.example.test')
  page.get_by_role('button',name='添加网站',exact=True).click()
  original=current(page)
  page.get_by_role('button',name='复制场景',exact=True).click()
  copied=current(page)
  assert copied['id']!=original['id'] and copied['apps'][0]['id']!=original['apps'][0]['id']
  record('explicit workspace copy remaps entity IDs')
  page.get_by_role('button',name='删除',exact=True).click()
  alert=page.get_by_role('alertdialog')
  expect(alert).to_be_visible();alert.get_by_role('button',name='取消',exact=True).click()
  assert len(state(page)['workspaces'])==3
  page.get_by_role('button',name='删除',exact=True).click();page.get_by_role('alertdialog').get_by_role('button',name='确认',exact=True).click()
  assert len(state(page)['workspaces'])==2
  page.get_by_role('button',name='撤销上一次删除',exact=True).click()
  assert len(state(page)['workspaces'])==3
  assert current(page)['id']!=copied['id']
  record('destructive confirmation, cancel and deletion undo')
  page.keyboard.press('Escape');expect(dialog).not_to_be_visible()
  page.get_by_role('button',name='打开命令中心',exact=True).click()
  command=page.get_by_role('dialog',name='命令中心')
  cmd=command.get_by_role('textbox')
  cmd.fill('todo 写回归测试')
  cmd.press('Enter')
  assert len(current(page)['settings']['todos'])==1
  assert current(page)['settings']['componentSettings']['todo']
  assert page.evaluate('window.__noReload')=='sentinel'
  expect(page.get_by_text('写回归测试',exact=True)).to_be_visible()
  page.get_by_role('button',name='添加任务',exact=True).click()
  todo=page.get_by_placeholder('添加新任务...')
  todo.fill('Enter 不重复');todo.press('Enter')
  assert len(current(page)['settings']['todos'])==2
  record('command adds visible todo without reload; Enter + blur inserts once')
  page.get_by_role('button',name='打开命令中心',exact=True).click()
  cmd=page.get_by_role('dialog',name='命令中心').get_by_role('textbox')
  cmd.fill('todo 输入法')
  cmd.evaluate("e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))")
  assert len(current(page)['settings']['todos'])==2
  cmd.fill('GitHub')
  expect(page.get_by_role('dialog',name='命令中心').get_by_role('button',name='GitHub 默认',exact=False)).to_be_visible()
  page.keyboard.press('Escape')
  record('composition confirmation is not a command; cross workspace search finds GitHub')
  page2=ctx.new_page(); page2.on('pageerror',lambda e: errors.append(str(e)));offline_render(page2, page.evaluate('Object.fromEntries(localStorage.values)'))
  page.get_by_role('button',name='整理网站',exact=True).first.click()
  dialog.locator('summary').click()
  page.get_by_label('工作区名称',exact=True).fill('即时同步场景')
  page.get_by_label('保存工作区名称',exact=True).click()
  page2.evaluate('values=>{for(const [key,value] of Object.entries(values)) localStorage.setItem(key,value);const event=new Event("storage");event.key="navinocode_advanced_state";window.dispatchEvent(event)}',page.evaluate('Object.fromEntries(localStorage.values)'))
  expect(page2.get_by_label('切换工作区',exact=True)).to_contain_text('即时同步场景')
  assert current(page2)['name']=='即时同步场景'
  record('second rendered page reacts to simulated storage event (storage is mocked)')
  dialog.locator('details').evaluate('e=>e.open=false')
  first=state(page)['workspaces'][0]['id']
  page.get_by_label('整理面板工作区',exact=True).select_option(first)
  page.get_by_label('移动 GitHub',exact=True).select_option(folder)
  page.get_by_label('移动 文档站',exact=True).select_option(folder)
  dialog.get_by_role('navigation').get_by_role('button',name='开发工具',exact=False).click()
  page.screenshot(path=str(output/'desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844})
  page.screenshot(path=str(output/'mobile.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
  assert dialog.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
  assert dialog.locator('main').evaluate('e=>e.clientHeight>100')
  record('390px organizer has no horizontal overflow and usable scroll area')
  assert not errors, errors
  record('no unhandled browser runtime errors')
  browser.close()
except Exception:
 traceback.print_exc()
 try:
  page.screenshot(path=str(output/'failure.png'),full_page=True)
  (output/'failure.html').write_text(page.content())
 except Exception: pass
 raise
finally:
 (output/'results.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
