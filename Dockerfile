FROM python:3.12-slim

WORKDIR /app

# Install dependencies first for layer caching.
COPY app/requirements.txt /app/app/requirements.txt
RUN pip install --no-cache-dir -r /app/app/requirements.txt

# Copy the application (overlaid by the bind mount in docker-compose so that
# in-app self-updates persist).
COPY . /app

EXPOSE 9920

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9920"]
