-- 05/11/2026 — Google → portale ogni minuto invece che ogni 2 (Davide: «anche meno»)
select cron.alter_job((select jobid from cron.job where jobname = 'gcal-pull'), schedule := '* * * * *');
