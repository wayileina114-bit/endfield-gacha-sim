# -*- coding: utf-8 -*-
css = """
/* ================= 官方记录视图 ================= */
.of-secnote { background: rgba(79,195,247,.06); border: 1px solid rgba(79,195,247,.25); border-radius: 8px; padding: 10px 14px; font-size: 12.5px; line-height: 1.7; color: #c7cede; margin-bottom: 14px; }
.of-form { display: grid; gap: 12px; max-width: 420px; }
.of-form label { display: grid; gap: 6px; font-size: 13px; color: #8a93b0; }
.of-form input[type=text], .of-form input[type=password] { background: #0e1524; border: 1px solid #2a3654; border-radius: 6px; padding: 10px 12px; color: #e8edf7; font-size: 14px; outline: none; }
.of-form input:focus { border-color: #f5a623; }
.of-remember { display: flex !important; align-items: center; gap: 8px !important; font-size: 12.5px; }
.of-roles { display: flex; gap: 8px; flex-wrap: wrap; }
.of-progress { font-size: 12.5px; color: #8a93b0; }
.of-recsum { margin-top: 10px; font-size: 12.5px; color: #8a93b0; }
.of-monthly { display: grid; gap: 6px; }
.of-mrow { display: grid; grid-template-columns: 52px 1fr 56px; align-items: center; gap: 8px; font-size: 12.5px; }
.of-mk { color: #8a93b0; }
.of-mbar { height: 12px; background: linear-gradient(90deg, rgba(245,166,35,.85), rgba(224,123,31,.6)); border-radius: 2px; min-width: 2px; }
.of-mv { text-align: right; font-variant-numeric: tabular-nums; }
.of-pred { padding: 10px 0; border-bottom: 1px dashed #2a3654; }
.of-pred:last-child { border-bottom: none; }
.of-pred-name { font-size: 13.5px; font-weight: 700; display: flex; justify-content: space-between; gap: 10px; }
.of-pred-nums { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; font-size: 12.5px; color: #c7cede; font-variant-numeric: tabular-nums; }
.of-cost { color: #f5a623; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th { text-align: left; color: #8a93b0; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #2a3654; }
.tbl td { padding: 7px 8px; border-bottom: 1px solid rgba(42,54,84,.45); }
"""
with open('public/css/style.css', 'a', encoding='utf-8') as f:
    f.write(css)
print('css appended')
