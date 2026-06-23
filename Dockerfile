FROM python:3.12-slim

WORKDIR /app

# Install dependencies first for layer caching.
COPY app/requirements.txt /app/app/requirements.txt
RUN pip install --no-cache-dir -r /app/app/requirements.txt

# Copy the application (overlaid by the bind mount in docker-compose so that
# in-app self-updates persist).
COPY . /app
RUN chmod +x /app/entrypoint.sh

EXPOSE 9920

# The entrypoint re-installs requirements on start so updates that add a new
# dependency self-heal when the updater restarts the container.
CMD ["bash", "/app/entrypoint.sh"]
