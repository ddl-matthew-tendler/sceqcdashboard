# deploy-google-run

If the user hasn't installed the gcloud tools, try to do that for them. 

I'd like to deploy this app to "google cloud run". I know on the website I have a project / billing account associated, and I have this url: https://console.cloud.google.com/run/overview?project=design-team-486316 

Do not use the docker container way, use the repo way. Alert me if a repo isn't available and encourage them to set that up. You can use "git status" on the path of this app project to figure out the repo stuff.

If there's some way to have a nice name and url for seperate apps on google cloud run, prompt me for that or just use a reasonable guess by the context of the project.

CRITICALLY IMPORTANT: Create a .python-version file in your project root for a version of python (like 3.13.5) that has great package support.. by default it seems to use the latest version of python which causes the build to never finish on pip install tasks.

Warn the user that the gcloud deploy can take 5 mins, WARN THEM IT COULD TAKE 5 mins!!!
